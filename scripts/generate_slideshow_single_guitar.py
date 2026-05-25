#!/usr/bin/env python3
"""Generate gentle single-guitar slideshow cues for the public music app.

This batch is intentionally more consonant than the duet/fusion set: one
centered nylon-style guitar, 80-90 bpm, mostly chord-tone arpeggios, small
melodic figures, and only very light slide noise.
"""

from __future__ import annotations

import json
import math
import subprocess
import tempfile
import wave
from dataclasses import dataclass
from pathlib import Path

try:
    import numpy as np
except ModuleNotFoundError as exc:
    raise SystemExit(
        "This generator needs numpy. On this machine, run it with "
        "`/opt/homebrew/bin/python3 scripts/generate_slideshow_single_guitar.py`."
    ) from exc


SR = 44_100
ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "assets" / "music" / "slideshow-guitar"
FFMPEG = "/opt/homebrew/bin/ffmpeg"
FFPROBE = "/opt/homebrew/bin/ffprobe"


@dataclass(frozen=True)
class Cue:
    title: str
    file: str
    mood: str
    bpm: int
    bars: int
    progression: tuple[str, ...]
    melody: tuple[int, ...]
    seed: int
    pattern: str


CHORDS = {
    "A": (45, 52, 57, 61, 64),
    "Am": (45, 52, 57, 60, 64),
    "Bb": (46, 53, 58, 62, 65),
    "Bm": (47, 54, 59, 62, 66),
    "C": (48, 55, 60, 64, 67),
    "D": (50, 57, 62, 66),
    "Dm": (50, 57, 62, 65),
    "Em": (40, 52, 55, 59, 64),
    "F": (41, 48, 53, 57, 60, 65),
    "G": (43, 50, 55, 59, 62, 67),
}


CUES = (
    Cue(
        title="Quiet Linden Study",
        file="quiet-linden-study-single-guitar-113s.mp3",
        mood="Single nylon guitar, plain major arpeggios",
        bpm=82,
        bars=38,
        progression=("C", "G", "Am", "F"),
        melody=(64, 67, 69, 67, 64, 62, 60, 62),
        seed=8631,
        pattern="plain",
    ),
    Cue(
        title="Warm Balcony Theme",
        file="warm-balcony-theme-single-guitar-107s.mp3",
        mood="Soft single-guitar theme with settled bass",
        bpm=86,
        bars=38,
        progression=("Am", "F", "C", "G"),
        melody=(69, 67, 64, 62, 60, 62, 64, 67),
        seed=8632,
        pattern="rolling",
    ),
    Cue(
        title="Open House Aria",
        file="open-house-aria-single-guitar-104s.mp3",
        mood="Slow lyrical guitar line over consonant chords",
        bpm=88,
        bars=38,
        progression=("Dm", "F", "C", "G"),
        melody=(65, 67, 69, 72, 69, 67, 65, 64),
        seed=8633,
        pattern="lyrical",
    ),
    Cue(
        title="Cedar Stairwell",
        file="cedar-stairwell-single-guitar-116s.mp3",
        mood="Very calm single-guitar picking at walking pace",
        bpm=80,
        bars=38,
        progression=("G", "D", "Em", "C"),
        melody=(67, 69, 71, 74, 71, 69, 67, 64),
        seed=8634,
        pattern="plain",
    ),
    Cue(
        title="Terrace in C",
        file="terrace-in-c-single-guitar-109s.mp3",
        mood="Consonant parlor-guitar arpeggios",
        bpm=84,
        bars=38,
        progression=("C", "Am", "F", "G"),
        melody=(60, 64, 67, 69, 67, 64, 62, 60),
        seed=8635,
        pattern="rolling",
    ),
    Cue(
        title="Window Light Etude",
        file="window-light-etude-single-guitar-103s.mp3",
        mood="Clean single-guitar study, light and steady",
        bpm=90,
        bars=38,
        progression=("D", "Bm", "G", "A"),
        melody=(66, 69, 71, 74, 71, 69, 66, 64),
        seed=8636,
        pattern="lyrical",
    ),
    Cue(
        title="Blue Hour Listing",
        file="blue-hour-listing-single-guitar-112s.mp3",
        mood="Subdued minor arpeggios without sharp edges",
        bpm=82,
        bars=38,
        progression=("Am", "C", "G", "F"),
        melody=(64, 67, 69, 72, 69, 67, 64, 60),
        seed=8637,
        pattern="plain",
    ),
    Cue(
        title="Ivory Courtyard",
        file="ivory-courtyard-single-guitar-106s.mp3",
        mood="Simple warm guitar, relaxed and consonant",
        bpm=86,
        bars=38,
        progression=("F", "C", "Dm", "Bb"),
        melody=(65, 67, 69, 72, 69, 67, 65, 62),
        seed=8638,
        pattern="rolling",
    ),
    Cue(
        title="Sunday Parlor",
        file="sunday-parlor-single-guitar-108s.mp3",
        mood="Gentle single-guitar salon miniature",
        bpm=84,
        bars=38,
        progression=("G", "C", "D", "G"),
        melody=(67, 69, 71, 72, 71, 69, 67, 62),
        seed=8639,
        pattern="plain",
    ),
    Cue(
        title="Soft Key Return",
        file="soft-key-return-single-guitar-101s.mp3",
        mood="Quiet closing cue for one nylon guitar",
        bpm=90,
        bars=38,
        progression=("C", "F", "G", "C"),
        melody=(72, 71, 69, 67, 64, 62, 60, 64),
        seed=8640,
        pattern="lyrical",
    ),
)


def midi_to_freq(midi: float) -> float:
    return 440.0 * (2.0 ** ((midi - 69.0) / 12.0))


def smooth_noise(rng: np.random.Generator, n: int) -> np.ndarray:
    noise = rng.normal(0.0, 1.0, n + 10)
    kernel = np.hanning(11)
    kernel /= kernel.sum()
    return np.convolve(noise, kernel, mode="valid")[:n]


def pan_stereo(mono: np.ndarray, pan: float) -> np.ndarray:
    angle = (pan + 1.0) * math.pi / 4.0
    return np.column_stack((mono * math.cos(angle), mono * math.sin(angle)))


def note_sample(
    midi: float,
    seconds: float,
    velocity: float,
    rng: np.random.Generator,
    *,
    sustain: float = 1.0,
    color: float = 0.8,
    slide_cents: float = 0.0,
) -> np.ndarray:
    n = max(1, int(seconds * SR))
    t = np.arange(n, dtype=np.float32) / SR
    freq = midi_to_freq(midi)
    cents = slide_cents * np.exp(-t / 0.045)
    phase = np.cumsum((2.0 * np.pi * freq * (2.0 ** (cents / 1200.0))) / SR)
    partials = np.zeros(n, dtype=np.float32)
    for harmonic in range(1, 12):
        rolloff = 1.0 / (harmonic ** 1.38)
        decay = np.exp(-t * (0.9 / sustain + harmonic * (0.22 + 0.035 * color) + freq * harmonic * 0.00034))
        partials += rolloff * decay * np.sin(harmonic * phase + rng.uniform(0.0, 2.0 * np.pi))
    envelope = (1.0 - np.exp(-t / 0.006)) * np.exp(-t / (seconds * 1.55 + 0.25))
    attack = smooth_noise(rng, n) * np.exp(-t / 0.016) * (0.12 + color * 0.04)
    nail = np.sin(2.0 * np.pi * min(4300.0, freq * 14.0) * t) * np.exp(-t / 0.005) * 0.035
    body = (
        np.sin(2.0 * np.pi * 96.0 * t) * np.exp(-t / 0.35) * 0.020
        + np.sin(2.0 * np.pi * 188.0 * t) * np.exp(-t / 0.24) * 0.014
    )
    mono = (partials * envelope + attack + nail + body) * velocity * 0.18
    return np.tanh(mono * 1.35)


def add_mono(mix: np.ndarray, mono: np.ndarray, start_seconds: float, pan: float, gain: float) -> None:
    start = int(start_seconds * SR)
    if start < 0:
        mono = mono[-start:]
        start = 0
    if start >= len(mix) or len(mono) == 0:
        return
    end = min(len(mix), start + len(mono))
    mix[start:end] += pan_stereo(mono[: end - start], pan) * gain


def add_note(
    mix: np.ndarray,
    midi: float,
    start: float,
    seconds: float,
    velocity: float,
    rng: np.random.Generator,
    *,
    pan: float = 0.0,
    sustain: float = 1.0,
    color: float = 0.8,
    slide_cents: float = 0.0,
) -> None:
    sample = note_sample(midi, seconds, velocity, rng, sustain=sustain, color=color, slide_cents=slide_cents)
    add_mono(mix, sample, start, pan, 1.0)


def add_fret_noise(mix: np.ndarray, start: float, rng: np.random.Generator) -> None:
    n = int(0.055 * SR)
    t = np.arange(n, dtype=np.float32) / SR
    mono = smooth_noise(rng, n) * np.exp(-t / 0.024) * 0.018
    add_mono(mix, mono, start, 0.04, 1.0)


def chord_tone(chord: str, position: int, high: bool = False) -> int:
    tones = CHORDS[chord]
    tone = tones[position % len(tones)]
    if high and tone < 60:
        tone += 12
    return tone


def render_bar(mix: np.ndarray, cue: Cue, bar: int, rng: np.random.Generator) -> None:
    beat = 60.0 / cue.bpm
    chord = cue.progression[bar % len(cue.progression)]
    start = bar * 4.0 * beat
    bass = chord_tone(chord, 0)
    high_order = (2, 3, 4, 3, 1, 3, 4, 3) if cue.pattern != "lyrical" else (2, 4, 3, 4, 2, 3, 4, 3)

    add_note(mix, bass, start + rng.uniform(-0.005, 0.005), beat * 1.55, 0.82, rng, pan=-0.04, sustain=1.08, color=0.6)
    add_note(mix, chord_tone(chord, 1), start + beat * 2.0, beat * 1.35, 0.58, rng, pan=-0.03, sustain=1.0, color=0.62)

    for idx, tone_idx in enumerate(high_order):
        offset = idx * 0.5 * beat
        if idx in (0, 4) and cue.pattern == "rolling":
            offset += 0.06 * beat
        midi = chord_tone(chord, tone_idx, high=True)
        add_note(
            mix,
            midi,
            start + offset + rng.uniform(-0.007, 0.007),
            beat * 1.05,
            0.48 + (0.08 if idx in (0, 4) else 0.0),
            rng,
            pan=0.03,
            sustain=1.05,
            color=0.72,
        )

    if bar % 2 == 1:
        first = cue.melody[(bar * 2) % len(cue.melody)]
        second = cue.melody[(bar * 2 + 1) % len(cue.melody)]
        add_fret_noise(mix, start + beat * 2.82, rng)
        add_note(mix, first, start + beat * 3.00, beat * 0.95, 0.42, rng, pan=0.06, sustain=1.14, color=0.78, slide_cents=-18.0)
        add_note(mix, second, start + beat * 3.48, beat * 1.05, 0.38, rng, pan=0.05, sustain=1.12, color=0.75)


def apply_room(mix: np.ndarray) -> np.ndarray:
    room = np.zeros_like(mix)
    for delay, gain in ((0.029, 0.10), (0.071, 0.08), (0.142, 0.045), (0.233, 0.025)):
        samples = int(delay * SR)
        room[samples:] += mix[:-samples] * gain
    out = mix + room
    out[:, 1] += np.concatenate((np.zeros(34, dtype=np.float32), out[:-34, 0] * 0.035))
    return np.tanh(out * 1.22) * 0.9


def fade_and_normalize(mix: np.ndarray) -> np.ndarray:
    fade_samples = min(int(4.0 * SR), len(mix) // 7)
    fade_in = np.linspace(0.0, 1.0, fade_samples, dtype=np.float32) ** 0.5
    fade_out = np.linspace(1.0, 0.0, fade_samples, dtype=np.float32) ** 1.3
    mix[:fade_samples] *= fade_in[:, None]
    mix[-fade_samples:] *= fade_out[:, None]
    peak = np.max(np.abs(mix))
    if peak > 0:
        mix = mix / peak * 0.9
    return mix


def write_wav(path: Path, audio: np.ndarray) -> None:
    pcm = np.clip(audio, -1.0, 1.0)
    pcm = (pcm * 32767.0).astype("<i2")
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(SR)
        wav.writeframes(pcm.tobytes())


def encode_mp3(wav_path: Path, mp3_path: Path) -> None:
    subprocess.run(
        [
            FFMPEG,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(wav_path),
            "-codec:a",
            "libmp3lame",
            "-b:a",
            "96k",
            str(mp3_path),
        ],
        check=True,
    )


def probe_duration(path: Path) -> float:
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
        text=True,
        capture_output=True,
    )
    return float(result.stdout.strip())


def render(cue: Cue) -> dict[str, object]:
    rng = np.random.default_rng(cue.seed)
    beat = 60.0 / cue.bpm
    seconds = cue.bars * 4.0 * beat
    mix = np.zeros((int((seconds + 1.8) * SR), 2), dtype=np.float32)
    for bar in range(cue.bars):
        render_bar(mix, cue, bar, rng)
    final_chord = cue.progression[-1]
    final_start = seconds - beat * 0.45
    for idx, midi in enumerate(CHORDS[final_chord][:5]):
        add_note(mix, midi + (12 if idx > 2 and midi < 60 else 0), final_start + idx * 0.045, beat * 3.4, 0.48, rng, sustain=1.55, color=0.62)
    mix = fade_and_normalize(apply_room(mix))

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    mp3_path = OUT_DIR / cue.file
    with tempfile.TemporaryDirectory() as tmp:
        wav_path = Path(tmp) / f"{mp3_path.stem}.wav"
        write_wav(wav_path, mix)
        encode_mp3(wav_path, mp3_path)
    duration = probe_duration(mp3_path)
    return {
        "title": cue.title,
        "mood": cue.mood,
        "bpm": cue.bpm,
        "duration": round(duration, 3),
        "src": f"./assets/music/slideshow-guitar/{cue.file}",
    }


def main() -> None:
    rendered = [render(cue) for cue in CUES]
    print(json.dumps(rendered, indent=2))


if __name__ == "__main__":
    main()
