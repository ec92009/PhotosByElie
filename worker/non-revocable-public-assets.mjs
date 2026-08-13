const ROOT_MUSIC_TRACKS = [
  "blue-hour-listing-single-guitar-112s.mp3",
  "cedar-stairwell-single-guitar-116s.mp3",
  "ivory-courtyard-single-guitar-106s.mp3",
  "open-house-aria-single-guitar-104s.mp3",
  "quiet-linden-study-single-guitar-113s.mp3",
  "soft-key-return-single-guitar-101s.mp3",
  "sunday-parlor-single-guitar-108s.mp3",
  "terrace-in-c-single-guitar-109s.mp3",
  "warm-balcony-theme-single-guitar-107s.mp3",
  "window-light-etude-single-guitar-103s.mp3",
];

const PUBLIC_DOMAIN_TRACK_NUMBERS = [
  "01", "02", "04", "05", "06", "07", "08", "10", "11", "13",
  "15", "16", "17", "20", "21", "23", "26", "27", "28", "29",
];

const PIXABAY_MUSIC_TRACKS = [
  "pixabay-classical-guitar-flamenco-flair.mp3",
  "pixabay-dance-of-andalusia.mp3",
  "pixabay-dreaming-on-guitar-strings.mp3",
  "pixabay-france-accordion-163872.mp3",
  "pixabay-france-french-cafe-music-471082.mp3",
  "pixabay-france-french-france-paris-music-469472.mp3",
  "pixabay-france-french-paris-cafe-music-350052.mp3",
  "pixabay-france-french-paris-cafe-music-464388.mp3",
  "pixabay-france-french-paris-romantic-music-464386.mp3",
  "pixabay-france-gypsy-soul-accordion-heart-364434.mp3",
  "pixabay-france-the-squeeze-of-romance-364436.mp3",
  "pixabay-gypsy-love-song-instrumental.mp3",
  "pixabay-latin-acoust-guitar-music.mp3",
  "pixabay-latin-dancing-guitar.mp3",
  "pixabay-latin-flamenco-tunetank.mp3",
  "pixabay-latin-guitars-and-strings.mp3",
  "pixabay-latin-mexican-flamenco.mp3",
  "pixabay-passionate-flamenco-instrumental.mp3",
  "pixabay-portugal-cinematic-guitar-adventure-505779.mp3",
  "pixabay-portugal-emotional-guitar-nostalgia-505780.mp3",
  "pixabay-portugal-guitar-music-522811.mp3",
  "pixabay-portugal-guitar-relaxing-audio-505623.mp3",
  "pixabay-portugal-instrumental-acoustic-guitar-music-504896.mp3",
  "pixabay-portugal-relaxing-guitar-adventure-514613.mp3",
  "pixabay-portugal-sad-guitar-memories-505663.mp3",
  "pixabay-portugal-warm-guitar-memories-505771.mp3",
  "pixabay-rumba-catalana-chill-out-barcelona-08.mp3",
  "pixabay-rumba-spanish-chords-backing-track.mp3",
  "pixabay-spanish-flamenco-studiokolomna.mp3",
  "pixabay-spanish-guitar-acoustic.mp3",
  "pixabay-spanish-motifs.mp3",
  "pixabay-spanish-nastelbom.mp3",
  "pixabay-usa-american-western-country-496543.mp3",
  "pixabay-usa-americana-instrumental-01-419201.mp3",
  "pixabay-usa-americana-instrumental-02-419200.mp3",
  "pixabay-usa-americana-instrumental-07-480727.mp3",
  "pixabay-usa-country-blues-instrumental-01-424049.mp3",
  "pixabay-usa-instrumental-music-acoustic-country-193189.mp3",
  "pixabay-usa-kansas-highways-neo-western-blues-instrumental-374788.mp3",
  "pixabay-usa-mocking-neo-western-blues-instrumental-391301.mp3",
];

export const NON_REVOCABLE_PUBLIC_ASSET_KEYS = Object.freeze([
  ...ROOT_MUSIC_TRACKS.map((name) => `assets/music/slideshow-guitar/${name}`),
  ...PUBLIC_DOMAIN_TRACK_NUMBERS.map(
    (number) => `assets/music/slideshow-guitar/public-domain/spanish-guitar-chords-${number}-cc0-wilfredor.mp3`,
  ),
  ...PIXABAY_MUSIC_TRACKS.map((name) => `assets/music/slideshow-guitar/pixabay/${name}`),
].sort());

const NON_REVOCABLE_PUBLIC_ASSET_SET = new Set(NON_REVOCABLE_PUBLIC_ASSET_KEYS);

export const isNonRevocablePublicAsset = (key) => NON_REVOCABLE_PUBLIC_ASSET_SET.has(String(key || ""));
