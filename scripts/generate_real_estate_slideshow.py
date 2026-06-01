#!/usr/bin/env python3
"""Render a local real-estate slideshow proof video with music.

The default proof pulls random still photos from the Elie real-estate context,
applies random Ken Burns-style motion, chooses one configured single-guitar cue
at random, and mixes music at 0 dB. The shared slideshow music config also
records the production rule for videos: source video audio is mixed 20 dB under
the generated music. Track credit metadata is preserved in the proof manifest
so any required video credit end-card can be audited with the render.
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
LANDSCAPE_SIZE = "1920x1080"
PORTRAIT_SIZE = "1080x1920"
LANDSCAPE_WORK = (2304, 1296)
PORTRAIT_WORK = (1296, 2304)
FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
]


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


def music_credit_entry(track: dict[str, Any]) -> dict[str, Any] | None:
    text = str(track.get("creditText") or "").strip()
    if not text:
        parts = [
            f"Music: {track.get('title')}" if track.get("title") else "",
            f"by {track.get('author')}" if track.get("author") else "",
            f"({track.get('license')})" if track.get("license") else "",
        ]
        text = " ".join(part for part in parts if part).strip()
    if not text:
        return None
    return {
        "text": text,
        "required": bool(track.get("creditRequired")),
        "title": track.get("title", ""),
        "author": track.get("author", ""),
        "source": track.get("source", ""),
        "sourceUrl": track.get("sourceUrl", ""),
        "license": track.get("license", ""),
        "licenseUrl": track.get("licenseUrl", ""),
    }


def ffmpeg_drawtext_escape(value: str) -> str:
    return str(value or "").replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")


def choose_font() -> str:
    for candidate in FONT_CANDIDATES:
        if Path(candidate).exists():
            return candidate
    raise RuntimeError("No usable system font found for slideshow watermark overlays.")


def render_geometry(orientation: str) -> tuple[str, int, int]:
    if orientation == "portrait":
        return PORTRAIT_SIZE, *PORTRAIT_WORK
    return LANDSCAPE_SIZE, *LANDSCAPE_WORK


def fit_filter(orientation: str) -> str:
    _, work_width, work_height = render_geometry(orientation)
    return ",".join([
        f"scale={work_width}:{work_height}:force_original_aspect_ratio=decrease",
        f"pad={work_width}:{work_height}:(ow-iw)/2:(oh-ih)/2:color=black",
    ])


def ken_burns_motion_filter(effect: str, duration: int, orientation: str) -> str:
    frames = max(1, duration * FPS)
    denom = max(1, frames - 1)
    size, work_width, work_height = render_geometry(orientation)
    if effect == "center-breathe-out":
        z = f"1.024-0.024*on/{denom}"
        x = "(iw-iw/zoom)*0.5"
        y = "(ih-ih/zoom)*0.5"
    elif effect == "center-drift-left":
        z = f"1.012+0.012*on/{denom}"
        x = f"(iw-iw/zoom)*(0.5-0.04*on/{denom})"
        y = "(ih-ih/zoom)*0.5"
    elif effect == "center-drift-right":
        z = f"1.012+0.012*on/{denom}"
        x = f"(iw-iw/zoom)*(0.5+0.04*on/{denom})"
        y = "(ih-ih/zoom)*0.5"
    elif effect == "center-drift-up":
        z = f"1.012+0.012*on/{denom}"
        x = "(iw-iw/zoom)*0.5"
        y = f"(ih-ih/zoom)*(0.5-0.04*on/{denom})"
    elif effect == "center-drift-down":
        z = f"1.012+0.012*on/{denom}"
        x = "(iw-iw/zoom)*0.5"
        y = f"(ih-ih/zoom)*(0.5+0.04*on/{denom})"
    else:
        z = f"1.0+0.024*on/{denom}"
        x = "(iw-iw/zoom)*0.5"
        y = "(ih-ih/zoom)*0.5"
    return ",".join([
        f"zoompan=z='{z}':x='{x}':y='{y}':d={frames}:s={size}:fps={FPS}",
        "setsar=1",
        "format=yuv420p",
    ])


def ken_burns_filter(effect: str, duration: int, orientation: str) -> str:
    return f"{fit_filter(orientation)},{ken_burns_motion_filter(effect, duration, orientation)}"


def write_segment_overlay(output: Path, width: int, height: int, watermark: str, counter: str, font: str) -> None:
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError as exc:
        raise RuntimeError(
            "Pillow is required for slideshow watermark overlays. Run `python3 -m pip install --user pillow`."
        ) from exc

    overlay = Image.new("RGBA", (width, height), (255, 255, 255, 0))
    draw = ImageDraw.Draw(overlay)
    watermark_text = str(watermark or "").strip()
    if watermark_text:
        repeat_font = ImageFont.truetype(font, max(22, round(min(width, height) / 18)))
        repeat_stroke = max(1, round(min(width, height) / 260))
        bbox = draw.textbbox((0, 0), watermark_text.upper(), font=repeat_font, stroke_width=repeat_stroke)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
        tile_padding = max(54, round(min(width, height) * 0.18))
        tile = Image.new("RGBA", (text_width + tile_padding * 2, text_height + tile_padding * 2), (255, 255, 255, 0))
        tile_draw = ImageDraw.Draw(tile)
        tile_draw.text(
            (tile_padding, tile_padding),
            watermark_text.upper(),
            font=repeat_font,
            fill=(255, 255, 255, 38),
            stroke_width=repeat_stroke,
            stroke_fill=(0, 0, 0, 32),
        )
        rotated = tile.rotate(-28, expand=True, resample=Image.Resampling.BICUBIC)
        step_x = max(180, round(rotated.width * 0.78))
        step_y = max(150, round(rotated.height * 0.72))
        for y in range(-rotated.height, height + rotated.height, step_y):
            row_offset = 0 if (y // step_y) % 2 == 0 else -(step_x // 2)
            for x in range(-rotated.width + row_offset, width + rotated.width, step_x):
                overlay.alpha_composite(rotated, (x, y))

        corner_font = ImageFont.truetype(font, max(18, round(min(width, height) / 24)))
        corner_stroke = max(1, round(min(width, height) / 360))
        corner_bbox = draw.textbbox((0, 0), "PhotosByElie", font=corner_font, stroke_width=corner_stroke)
        margin = max(18, round(min(width, height) / 36))
        corner_position = (
            max(margin, width - (corner_bbox[2] - corner_bbox[0]) - margin),
            max(margin, height - (corner_bbox[3] - corner_bbox[1]) - margin),
        )
        draw.text(
            corner_position,
            "PhotosByElie",
            font=corner_font,
            fill=(255, 255, 255, 185),
            stroke_width=corner_stroke,
            stroke_fill=(0, 0, 0, 122),
        )

    if counter:
        counter_font = ImageFont.truetype(font, max(24, round(min(width, height) / 44)))
        padding_x = max(9, round(min(width, height) / 140))
        padding_y = max(6, round(min(width, height) / 210))
        box_margin = max(24, round(min(width, height) / 54))
        bbox = draw.textbbox((0, 0), counter, font=counter_font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
        x = box_margin
        y = height - box_margin - text_height - padding_y * 2
        draw.rounded_rectangle(
            (x, y, x + text_width + padding_x * 2, y + text_height + padding_y * 2),
            radius=max(3, round(min(width, height) / 360)),
            fill=(80, 80, 80, 198),
        )
        draw.text((x + padding_x, y + padding_y), counter, font=counter_font, fill=(255, 255, 255, 255))

    overlay.save(output)


def render_segment(
    photo: dict[str, Any],
    output: Path,
    duration: int,
    effect: str,
    orientation: str,
    counter: str,
    watermark_text: str,
    font: str,
) -> None:
    _, work_width, work_height = render_geometry(orientation)
    overlay = output.with_suffix(".overlay.png")
    write_segment_overlay(overlay, work_width, work_height, watermark_text, counter, font)
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
        "-loop",
        "1",
        "-i",
        str(overlay),
        "-t",
        str(duration),
        "-filter_complex",
        f"[0:v]{fit_filter(orientation)}[base];[base][1:v]overlay=0:0:format=auto,{ken_burns_motion_filter(effect, duration, orientation)}[v]",
        "-map",
        "[v]",
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


def add_music(video: Path, music: Path, output: Path, total_seconds: int, music_gain_db: float, fade_seconds: int) -> None:
    fade_duration = max(0.1, min(float(total_seconds), float(fade_seconds or 2)))
    fade_start = max(0, float(total_seconds) - fade_duration)
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
        f"[1:a]volume={music_gain_db}dB,atrim=0:{total_seconds},afade=t=out:st={fade_start:.3f}:d={fade_duration:.3f}[a]",
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
    parser.add_argument("--orientation", choices=["landscape", "portrait"], default="landscape")
    parser.add_argument("--watermark-text", default="\u00a9 2026 Photos By Elie")
    parser.add_argument("--no-watermark", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    seed = args.seed if args.seed is not None else secrets.randbelow(1_000_000_000)
    rng = random.Random(seed)
    payload = load_context(args.context)
    album, photos = choose_photos(payload, args.context, args.count, rng)
    config, track, music_path = load_music(rng)
    effects = [
        "center-breathe-in",
        "center-breathe-out",
        "center-drift-left",
        "center-drift-right",
        "center-drift-up",
        "center-drift-down",
    ]
    chosen_effects = [rng.choice(effects) for _ in photos]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output_dir = OUTPUT_ROOT / f"elie-{album}-{stamp}"
    output_dir.mkdir(parents=True, exist_ok=True)
    output = args.output or (output_dir / f"elie-{album}-10x{args.seconds}s-{args.orientation}-music.mp4")
    total_seconds = args.count * args.seconds
    watermark_text = "" if args.no_watermark else str(args.watermark_text or "").strip()
    font = choose_font()
    music_credit = music_credit_entry(track)

    with tempfile.TemporaryDirectory(dir=output_dir) as tmp:
        tmp_path = Path(tmp)
        segments = []
        for index, (photo, effect) in enumerate(zip(photos, chosen_effects), start=1):
            segment = tmp_path / f"segment-{index:02d}.mp4"
            render_segment(
                photo,
                segment,
                args.seconds,
                effect,
                args.orientation,
                f"{index}/{len(photos)}",
                watermark_text,
                font,
            )
            segments.append(segment)
        silent = tmp_path / "silent.mp4"
        concat_segments(segments, silent)
        add_music(silent, music_path, output, total_seconds, float(config.get("musicGainDb", 0)), args.seconds)

    manifest = {
        "schema": "photosbyelie.realEstateSlideshowProof.v1",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "seed": seed,
        "context": str(args.context),
        "album": album,
        "photoDurationSeconds": args.seconds,
        "outputOrientation": args.orientation,
        "outputAspectRatio": "9:16" if args.orientation == "portrait" else "16:9",
        "fitMode": "contain",
        "barTreatment": "black-bars",
        "playback": "once-no-loop",
        "musicFadeOutSeconds": args.seconds,
        "overlayOrder": "watermark-and-counter-before-ken-burns",
        "watermarkEnabled": bool(watermark_text),
        "watermarkText": watermark_text,
        "output": str(output),
        "durationSeconds": ffprobe_duration(output),
        "music": {
            **track,
            "path": str(music_path),
            "musicGainDb": config.get("musicGainDb", 0),
        },
        "musicCredits": {
            **(config.get("creditPolicy") or {"renderPolicy": "append-end-card-when-required", "durationSeconds": 4}),
            "entries": [music_credit] if music_credit else [],
        },
        "sourceVideoAudioGainDb": config.get("sourceVideoAudioGainDb", -20),
        "sourceVideoAudioLinearGain": config.get("sourceVideoAudioLinearGain", 0.1),
        "transition": config.get("transition", "subtle-centered-ken-burns"),
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
