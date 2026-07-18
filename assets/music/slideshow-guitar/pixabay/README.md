# Pixabay guitar audition candidates

This folder contains a curated mobile-audition pack of country-tagged Pixabay Music candidates for Photos By Elie slideshow work.

- Source: https://pixabay.com/music/
- License summary: https://pixabay.com/service/license-summary/
- Attribution: Pixabay does not require attribution in the license summary, but Photos By Elie stores author/source metadata and marks these tracks `creditRequired: true` so generated videos append a music-credit card.
- Audio normalization: local MP3 copies are normalized to approximately `-14 LUFS` integrated loudness with a `-1.5 dBTP` true-peak target for consistent iPhone auditioning.

The manifest `pixabay-guitar-candidates.json` is the source of the audition page entries and currently groups candidates by `country`: Spain, Portugal, France, and USA.

For cloud slideshow rendering, prepare bounded audio separately with
`scripts/prepare_slideshow_music_clips.py`. The tool is a dry run unless
`--execute` is present. It writes 60-second, 192 kbps MP3 clips with a one-second
fade-out below ignored `tmp/slideshow-music-clips/`, verifies each result with
ffprobe plus SHA-256, and emits a derived manifest and upload commands. It never
rewrites this source manifest or uploads automatically.
