#!/usr/bin/env python3
"""Focused tests for slideshow music clip staging."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


SCRIPT_PATH = Path(__file__).with_name("prepare_slideshow_music_clips.py")
SPEC = importlib.util.spec_from_file_location("prepare_slideshow_music_clips", SCRIPT_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class PrepareSlideshowMusicClipsTest(unittest.TestCase):
    def test_clip_key_is_separate_and_stable(self) -> None:
        track = {
            "src": "./assets/music/slideshow-guitar/pixabay/example.mp3",
            "r2Key": "assets/music/slideshow-guitar/pixabay/example.mp3",
        }
        self.assertEqual(
            MODULE.clip_r2_key(track, 60.0),
            "assets/music/slideshow-guitar/pixabay/clips-060s/example-clip-060s.mp3",
        )
        with self.assertRaisesRegex(ValueError, "Unsafe R2 audio key"):
            MODULE.clip_r2_key({"src": "../example.mp3"}, 60.0)

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg tools required")
    def test_execute_preserves_track_fields_and_verifies_fade(self) -> None:
        ffmpeg = shutil.which("ffmpeg")
        ffprobe = shutil.which("ffprobe")
        assert ffmpeg and ffprobe
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            source_dir = root / "assets/music/test"
            source_dir.mkdir(parents=True)
            source = source_dir / "tone.mp3"
            subprocess.run([
                ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
                "-f", "lavfi", "-i", "sine=frequency=440:duration=1.2",
                "-codec:a", "libmp3lame", str(source),
            ], check=True)
            track = {
                "id": "tone", "src": "./assets/music/test/tone.mp3", "localFile": "tone.mp3",
                "r2Key": "assets/music/test/tone.mp3",
                "creditText": "Music: Tone by Test", "creditRequired": True,
            }
            manifest = source_dir / "manifest.json"
            manifest.write_text(json.dumps({"schema": "test", "tracks": [track]}), encoding="utf-8")
            output_root = root / "tmp"
            original_root = MODULE.REPO_ROOT
            MODULE.REPO_ROOT = root
            try:
                report = MODULE.prepare_manifest(
                    manifest, output_root, 2.0, 0.5, True, False, ffmpeg, ffprobe,
                )
                self.assertEqual(report["createdCount"], 1)
                derived = json.loads(Path(report["preparedManifest"]).read_text(encoding="utf-8"))
                prepared = derived["tracks"][0]
                self.assertEqual({key: prepared[key] for key in track}, track)
                self.assertTrue(prepared["preparedClip"]["fadeVerification"]["verified"])
                self.assertTrue(prepared["preparedClip"]["sourceLooped"])
                self.assertEqual(prepared["preparedClip"]["r2Key"], "assets/music/test/clips-002s/tone-clip-002s.mp3")
                self.assertEqual(len(prepared["preparedClip"]["sourceSha256"]), 64)
                self.assertEqual(len(prepared["preparedClip"]["sha256"]), 64)

                second = MODULE.prepare_manifest(
                    manifest, output_root, 2.0, 0.5, True, False, ffmpeg, ffprobe,
                )
                self.assertEqual(second["createdCount"], 0)
                self.assertEqual(second["reusedCount"], 1)
            finally:
                MODULE.REPO_ROOT = original_root


if __name__ == "__main__":
    unittest.main()
