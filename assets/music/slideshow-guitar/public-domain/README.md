# Public-domain Spanish guitar clips

This folder keeps the 20 MP3 transcodes from Wikimedia Commons category
`Spanish guitar sound` that are at least 30 seconds long for the slideshow
guitar preview gallery.

- Source category: https://commons.wikimedia.org/wiki/Category:Spanish_guitar_sound
- License: CC0 1.0 Universal Public Domain Dedication
- Attribution: not required for CC0, but source, author, license, and credit text
  are retained in `commons-spanish-guitar.json`.
- Author metadata reported by Commons: Wilfredor
- Removed clips: 9 source clips shorter than 30 seconds are listed in the
  manifest's `removedTrackIds`.
- Audio normalization: kept clips are normalized to approximately `-14 LUFS`
  integrated loudness with a `-1.5 dBTP` true-peak target so they sit near the
  original Photos By Elie cue library.

The real-estate video manifest format can carry per-track credit metadata and
append an end-card only when `creditRequired` is true. These CC0 clips set
`creditRequired` to false.
