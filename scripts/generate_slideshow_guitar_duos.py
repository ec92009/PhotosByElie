#!/usr/bin/env python3
"""Generate two-guitar slideshow cues for the public music app.

The renderer uses an original lightweight plucked-string style synth: one
guitar carries panned strums/arpeggios while a second guitar plays lead phrases
with slides, bends, vibrato, and fret noise. It intentionally avoids quoting
existing songs or artist melodies.
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
        "`/opt/homebrew/bin/python3 scripts/generate_slideshow_guitar_duos.py`."
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
    meter: int
    progression: tuple[str, ...]
    scale: tuple[int, ...]
    root_midi: int
    seed: int
    feel: str


CHORDS = {
    "Am": (45, 52, 57, 60, 64),
    "A7": (45, 52, 57, 61, 64, 67),
    "A": (45, 52, 57, 61, 64),
    "Dm": (50, 57, 62, 65),
    "D": (50, 57, 62, 66),
    "E": (40, 52, 56, 64),
    "E7": (40, 52, 56, 62, 64),
    "F": (41, 48, 53, 57, 60, 65),
    "G": (43, 50, 55, 59, 62, 67),
    "C": (48, 55, 60, 64, 67),
    "Em": (40, 52, 55, 59, 64),
    "Bm7b5": (47, 53, 57, 62, 65),
    "Bb": (46, 53, 58, 62, 65),
}


CUES = (
    Cue(
        title="Solar Rumba Duo",
        file="solar-rumba-duo-two-guitars-095s.mp3",
        mood="Two-guitar Latin rumba, nylon rhythm and singing lead",
        bpm=96,
        bars=38,
        meter=4,
        progression=("Am", "G", "F", "E7"),
        scale=(0, 2, 3, 5, 7, 8, 10, 12),
        root_midi=57,
        seed=8611,
        feel="rumba",
    ),
    Cue(
        title="Desert Palm Conversation",
        file="desert-palm-conversation-two-guitars-100s.mp3",
        mood="Nouveau flamenco-style duet with soft call and response",
        bpm=90,
        bars=38,
        meter=4,
        progression=("Dm", "C", "Bb", "A7"),
        scale=(0, 1, 3, 5, 7, 8, 10, 12),
        root_midi=62,
        seed=8612,
        feel="arpeggio",
    ),
    Cue(
        title="Cypress Firelight",
        file="cypress-firelight-two-guitars-087s.mp3",
        mood="Bright world-fusion guitar duet, brisk and polished",
        bpm=104,
        bars=38,
        meter=4,
        progression=("Am", "Dm", "G", "E7"),
        scale=(0, 2, 3, 5, 7, 9, 10, 12),
        root_midi=57,
        seed=8613,
        feel="fusion",
    ),
    Cue(
        title="Two Roads to Malaga",
        file="two-roads-to-malaga-two-guitars-082s.mp3",
        mood="Fast Spanish guitar dialogue with percussive strums",
        bpm=112,
        bars=38,
        meter=4,
        progression=("Em", "F", "G", "E7"),
        scale=(0, 1, 3, 5, 7, 8, 10, 12),
        root_midi=64,
        seed=8614,
        feel="rumba",
    ),
    Cue(
        title="Nouveau Patio",
        file="nouveau-patio-two-guitars-103s.mp3",
        mood="Relaxed two-guitar groove with warm melodic slides",
        bpm=88,
        bars=38,
        meter=4,
        progression=("Am", "F", "C", "G"),
        scale=(0, 2, 3, 5, 7, 9, 10, 12),
        root_midi=57,
        seed=8615,
        feel="arpeggio",
    ),
    Cue(
        title="Strummed Horizon",
        file="strummed-horizon-two-guitars-091s.mp3",
        mood="Latin-rock flavored nylon duet, steady slideshow pulse",
        bpm=100,
        bars=38,
        meter=4,
        progression=("A", "G", "D", "E7"),
        scale=(0, 2, 4, 5, 7, 9, 10, 12),
        root_midi=57,
        seed=8616,
        feel="fusion",
    ),
    Cue(
        title="Midnight Mercado",
        file="midnight-mercado-two-guitars-096s.mp3",
        mood="Darker guitar pair with Phrygian color and muted taps",
        bpm=94,
        bars=38,
        meter=4,
        progression=("Am", "Bb", "F", "E7"),
        scale=(0, 1, 3, 5, 7, 8, 10, 12),
        root_midi=57,
        seed=8617,
        feel="rumba",
    ),
    Cue(
        title="Copper Strings",
        file="copper-strings-two-guitars-079s.mp3",
        mood="Up-tempo guitar duet with agile lead flourishes",
        bpm=116,
        bars=38,
        meter=4,
        progression=("Dm", "G", "C", "A7"),
        scale=(0, 2, 3, 5, 7, 9, 10, 12),
        root_midi=62,
        seed=8618,
        feel="fusion",
    ),
    Cue(
        title="Blue Tile Groove",
        file="blue-tile-groove-two-guitars-106s.mp3",
        mood="Subdued but moving two-guitar patio groove",
        bpm=86,
        bars=38,
        meter=4,
        progression=("Em", "C", "G", "D"),
        scale=(0, 2, 3, 5, 7, 9, 10, 12),
        root_midi=64,
        seed=8619,
        feel="arpeggio",
    ),
    Cue(
        title="Southbound Duet",
        file="southbound-duet-two-guitars-084s.mp3",
        mood="Clean Latin/world-fusion closer for two guitars",
        bpm=108,
        bars=38,
        meter=4,
        progression=("Am", "Dm", "F", "E7"),
        scale=(0, 2, 3, 5, 7, 8, 10, 12),
        root_midi=57,
        seed=8620,
        feel="rumba",
    ),
)


def midi_to_freq(midi: float) -> float:
    return 440.0 * (2.0 ** ((midi - 69.0) / 12.0))


def pan_stereo(mono: np.ndarray, pan: float) -> np.ndarray:
    angle = (pan + 1.0) * math.pi / 4.0
    return np.column_stack((mono * math.cos(angle), mono * math.sin(angle)))


def lowpass_noise(rng: np.random.Generator, n: int) -> np.ndarray:
    noise = rng.normal(0.0, 1.0, n + 16)
    kernel = np.hanning(17)
    kernel /= kernel.sum()
    return np.convolve(noise, kernel, mode="valid")[:n]


def note_sample(
    midi: float,
    seconds: float,
    velocity: float,
    rng: np.random.Generator,
    *,
    vibrato: float = 0.0,
    slide_cents: float = 0.0,
    bright: float = 1.0,
    sustain: float = 1.0,
) -> np.ndarray:
    n = max(1, int(seconds * SR))
    t = np.arange(n, dtype=np.float32) / SR
    freq = midi_to_freq(midi)
    cents = slide_cents * np.exp(-t / 0.055)
    if vibrato:
        vib_ramp = 1.0 - np.exp(-t / 0.35)
        cents += vibrato * vib_ramp * np.sin(2.0 * np.pi * 5.8 * t)
    phase = np.cumsum((2.0 * np.pi * freq * (2.0 ** (cents / 1200.0))) / SR)
    partials = np.zeros(n, dtype=np.float32)
    harmonic_count = 18 if bright > 1.0 else 14
    for harmonic in range(1, harmonic_count + 1):
        harmonic_rolloff = 1.0 / (harmonic ** (1.12 if bright > 1.0 else 1.28))
        decay = np.exp(-t * (0.85 / sustain + harmonic * (0.23 + 0.018 * bright) + freq * harmonic * 0.00042))
        phase_jitter = rng.uniform(0.0, 2.0 * np.pi)
        partials += harmonic_rolloff * decay * np.sin(harmonic * phase + phase_jitter)
    attack = np.exp(-t / 0.018) * lowpass_noise(rng, n) * (0.24 + 0.10 * bright)
    nail = np.exp(-t / 0.005) * np.sin(2.0 * np.pi * min(5600.0, freq * 18.0) * t) * 0.08
    envelope = (1.0 - np.exp(-t / 0.004)) * np.exp(-t / (seconds * 1.4 + 0.18))
    mono = (partials * envelope + attack + nail) * velocity * 0.17
    body = (
        np.exp(-t / 0.32) * np.sin(2.0 * np.pi * 96.0 * t) * 0.025
        + np.exp(-t / 0.24) * np.sin(2.0 * np.pi * 184.0 * t) * 0.018
        + np.exp(-t / 0.18) * np.sin(2.0 * np.pi * 242.0 * t) * 0.012
    )
    mono += body * velocity
    return np.tanh(mono * 1.5)


def add_mono(
    mix: np.ndarray,
    mono: np.ndarray,
    start_seconds: float,
    pan: float,
    gain: float,
) -> None:
    start = int(start_seconds * SR)
    if start < 0:
        mono = mono[-start:]
        start = 0
    if start >= len(mix):
        return
    end = min(len(mix), start + len(mono))
    segment = pan_stereo(mono[: end - start], pan) * gain
    mix[start:end] += segment


def add_strum(
    mix: np.ndarray,
    chord: str,
    start: float,
    length: float,
    rng: np.random.Generator,
    *,
    down: bool,
    pan: float,
    gain: float,
) -> None:
    notes = list(CHORDS[chord])
    if not down:
        notes = list(reversed(notes))
    delay = rng.uniform(0.011, 0.024)
    for idx, midi in enumerate(notes):
        dur = max(0.18, length - idx * delay * 0.6)
        vel = gain * rng.uniform(0.78, 1.08) * (0.92 if idx > 2 else 1.0)
        sample = note_sample(midi, dur, vel, rng, bright=1.08, sustain=0.92)
        add_mono(mix, sample, start + idx * delay, pan, 1.0)


def add_arpeggio(
    mix: np.ndarray,
    chord: str,
    bar_start: float,
    beat: float,
    rng: np.random.Generator,
    *,
    pan: float,
    gain: float,
) -> None:
    notes = list(CHORDS[chord])
    pattern = (0, 2, 4, 3, 1, 3, 4, 2)
    for idx, note_idx in enumerate(pattern):
        midi = notes[note_idx % len(notes)]
        start = bar_start + idx * beat * 0.5 + rng.uniform(-0.01, 0.012)
        sample = note_sample(midi, beat * 1.25, gain * rng.uniform(0.72, 1.0), rng, bright=0.9, sustain=1.12)
        add_mono(mix, sample, start, pan, 1.0)


def add_chuck(mix: np.ndarray, start: float, rng: np.random.Generator, pan: float, gain: float) -> None:
    n = int(0.055 * SR)
    t = np.arange(n, dtype=np.float32) / SR
    noise = lowpass_noise(rng, n)
    click = np.sin(2.0 * np.pi * 1850.0 * t) * np.exp(-t / 0.008)
    mono = (noise * np.exp(-t / 0.018) * 0.22 + click * 0.06) * gain
    add_mono(mix, mono, start, pan, 1.0)


def rhythm_guitar(mix: np.ndarray, cue: Cue, rng: np.random.Generator) -> None:
    beat = 60.0 / cue.bpm
    for bar in range(cue.bars):
        chord = cue.progression[bar % len(cue.progression)]
        bar_start = bar * cue.meter * beat
        if cue.feel == "arpeggio" and bar % 2 == 0:
            add_arpeggio(mix, chord, bar_start, beat, rng, pan=-0.48, gain=0.86)
            add_strum(mix, chord, bar_start + beat * 3.02, beat * 1.2, rng, down=True, pan=-0.42, gain=0.58)
            continue
        if cue.feel == "fusion":
            offsets = (0.0, 0.72, 1.48, 2.0, 2.72, 3.42)
        else:
            offsets = (0.0, 0.78, 1.55, 2.22, 3.0, 3.52)
        for idx, offset in enumerate(offsets):
            down = idx in (0, 2, 4)
            local_gain = 0.66 if idx in (1, 3, 5) else 0.86
            add_strum(
                mix,
                chord,
                bar_start + offset * beat + rng.uniform(-0.012, 0.012),
                beat * 1.05,
                rng,
                down=down,
                pan=-0.5 + rng.uniform(-0.04, 0.03),
                gain=local_gain,
            )
        if bar % 2 == 1:
            add_chuck(mix, bar_start + beat * 1.95, rng, pan=-0.38, gain=0.48)


def lead_guitar(mix: np.ndarray, cue: Cue, rng: np.random.Generator) -> None:
    beat = 60.0 / cue.bpm
    phrase_shapes = (
        (0, 3, 5, 7, 5, 3, 2, 0),
        (7, 8, 10, 12, 10, 8, 7, 5),
        (12, 10, 8, 7, 5, 7, 3, 0),
        (3, 5, 7, 10, 8, 7, 5, 3),
        (0, 2, 3, 7, 10, 7, 5, 3),
    )
    durations = (0.42, 0.28, 0.56, 0.34, 0.72, 0.32, 0.32, 0.86)
    start_bar = 1
    phrase_index = 0
    while start_bar < cue.bars - 1:
        bar_start = start_bar * cue.meter * beat
        shape = phrase_shapes[(phrase_index + cue.seed) % len(phrase_shapes)]
        phrase_gain = 0.86 if start_bar % 8 else 0.98
        cursor = bar_start + rng.uniform(0.0, 0.05)
        for idx, scale_step in enumerate(shape):
            scale_degree = cue.scale[scale_step % len(cue.scale)] + 12 * (scale_step // len(cue.scale))
            octave_shift = 0 if idx < 5 else rng.choice((0, 12), p=(0.82, 0.18))
            midi = cue.root_midi + scale_degree + octave_shift
            dur = durations[idx % len(durations)] * beat * rng.uniform(0.92, 1.18)
            slide = rng.choice((-85.0, -55.0, 0.0, 45.0), p=(0.28, 0.22, 0.35, 0.15))
            vibrato = rng.uniform(6.0, 14.0) if dur > beat * 0.48 else rng.uniform(1.5, 4.0)
            sample = note_sample(
                midi,
                dur + beat * 0.6,
                phrase_gain * rng.uniform(0.7, 1.0),
                rng,
                vibrato=vibrato,
                slide_cents=slide,
                bright=1.25,
                sustain=1.36,
            )
            add_mono(mix, sample, cursor, pan=0.43 + rng.uniform(-0.04, 0.06), gain=0.9)
            if slide:
                add_fret_squeak(mix, cursor - 0.035, rng, pan=0.48, gain=0.22)
            cursor += dur * rng.uniform(0.72, 1.05)
        if phrase_index % 3 == 1:
            harmony_bar = min(start_bar + 1, cue.bars - 2)
            add_harmony_answer(mix, cue, harmony_bar * cue.meter * beat + beat * 0.3, rng)
        start_bar += 2
        phrase_index += 1


def add_fret_squeak(mix: np.ndarray, start: float, rng: np.random.Generator, pan: float, gain: float) -> None:
    n = int(0.09 * SR)
    t = np.arange(n, dtype=np.float32) / SR
    noise = rng.normal(0.0, 1.0, n)
    sweep = np.sin(2.0 * np.pi * (2200.0 + 1700.0 * t / max(t[-1], 0.001)) * t)
    mono = np.convolve(noise * sweep, np.hanning(9) / np.hanning(9).sum(), mode="same")
    mono *= np.exp(-t / 0.03) * gain * 0.12
    add_mono(mix, mono, start, pan, 1.0)


def add_harmony_answer(mix: np.ndarray, cue: Cue, start: float, rng: np.random.Generator) -> None:
    beat = 60.0 / cue.bpm
    motif = (7, 5, 3, 2, 0)
    for idx, step in enumerate(motif):
        scale_degree = cue.scale[step % len(cue.scale)]
        midi = cue.root_midi + scale_degree + 12
        sample = note_sample(
            midi,
            beat * 0.9,
            0.58 * rng.uniform(0.8, 1.0),
            rng,
            vibrato=rng.uniform(3.0, 8.0),
            slide_cents=-35.0 if idx == 0 else 0.0,
            bright=1.05,
            sustain=1.12,
        )
        add_mono(mix, sample, start + idx * beat * 0.48, pan=0.12, gain=0.58)


def apply_room(mix: np.ndarray) -> np.ndarray:
    wet = np.zeros_like(mix)
    for delay, gain in ((0.032, 0.16), (0.067, 0.12), (0.123, 0.075), (0.211, 0.045)):
        samples = int(delay * SR)
        wet[samples:] += mix[:-samples] * gain
    out = mix + wet
    for channel in range(2):
        y = out[:, channel]
        y[1:] = y[1:] - 0.965 * y[:-1] * 0.018
        out[:, channel] = y
    return np.tanh(out * 1.28) * 0.88


def fade(mix: np.ndarray) -> np.ndarray:
    fade_samples = min(int(4.0 * SR), len(mix) // 8)
    if fade_samples:
        fade_in = np.linspace(0.0, 1.0, fade_samples, dtype=np.float32) ** 0.5
        fade_out = np.linspace(1.0, 0.0, fade_samples, dtype=np.float32) ** 1.2
        mix[:fade_samples] *= fade_in[:, None]
        mix[-fade_samples:] *= fade_out[:, None]
    peak = np.max(np.abs(mix))
    if peak > 0:
        mix = mix / peak * 0.92
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
    seconds = cue.bars * cue.meter * beat
    mix = np.zeros((int((seconds + 2.0) * SR), 2), dtype=np.float32)
    rhythm_guitar(mix, cue, rng)
    lead_guitar(mix, cue, rng)
    mix = fade(apply_room(mix))
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
