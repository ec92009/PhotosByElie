# PhotosByElie Handoff

Use this when moving work between Max and David.

## Current Handoff: 2026-05-06 Morning

- GitHub sync point: `09afd72 photosbyelie: refresh backlog after handoff`; local `main` is aligned with `origin/main` at this commit.
- This Max checkout still has local working-tree changes from owner review, public asset refreshes, basket/order work, and fulfillment scripting.
- New fulfillment script: `scripts/create_digital_delivery.py`.
  - Reads the prepared basket email from a text file or stdin.
  - Uses the email `Order ID` / `Delivery ZIP` GUID to create `deliveries/photosbyelie-order-<guid>.zip`.
  - Creates one subfolder per ordered photo and writes the ordered digital JPGs at quality 90 by default.
  - `deliveries/` is ignored and should stay local.
- Important RAW caveat: the delivery script now refuses DNG/RAW originals. `sips` can export only the embedded preview, which may be under 1 MP and is not a customer deliverable.
- Current policy for digital fulfillment:
  - JPG/TIFF source masters can be delivered by the script.
  - DNG/RAW source originals require a developed/exported JPG/TIFF master first.
  - Darktable/RawTherapee are possible future free RAW renderers, but they will not reproduce old Lightroom edits automatically.
- Basket email now includes a stable order GUID, requested delivery ZIP name, photo IDs, and original source paths so fulfillment can identify the exact source.
- `TODO.md` has been merged with David's latest backlog commit and uses the newer "Review Snapshot" language.

Suggested first commands on David:

```bash
cd /Users/ecohen/Dev/PhotosByElie
git pull --ff-only origin main
python3 scripts/local_server.py 8000
```

For an actual digital order email saved as `order-email.txt`:

```bash
python3 scripts/create_digital_delivery.py order-email.txt
```

## First Read

- Repo root: `/Users/ecohen/Dev/PhotosByElie`
- Local owner server: `python3 scripts/local_server.py 8000`
- Owner pages need the local server, not `python3 -m http.server`, because live review actions use localhost-only endpoints.
- Git carries the public site, `assets/expo`, `photos-data.js`, `assets/expo-manifest.json`, and tracked handoff metadata.
- Git does not carry the local vault assets in `assets/reserve/**` or `assets/hidden/**`.

## Current Asset States

- `assets/expo/<country>/`: tracked, publishable, public Expo JPEG pairs.
- `assets/reserve/<country>/`: ignored local Reserve JPEG pairs and catalogs.
- `assets/hidden/<country>/`: ignored local Hidden JPEG pairs and catalog.
- `assets/owner-actions/country-assignments.jsonl`: tracked append-only Unknown-to-country move log.
- `assets/owner-actions/country-assignments.json`: tracked latest Unknown-to-country assignment index by photo ID.

## Unknown Country Moves

Unknown assignment is live, not staged in browser storage.

When a photo is assigned to a country from `unknown.html`, the local server should:

1. Move the chosen photo and same-day Unknown cohort out of `assets/reserve/unknown/` or Expo Unknown.
2. Put the JPEG pairs under `assets/reserve/<country>/`.
3. Rewrite `assets/reserve/reserve-data.json`, `photos-data.js`, and `assets/expo-manifest.json`.
4. Record every move in `assets/owner-actions/country-assignments.jsonl`.
5. Update the latest-state index in `assets/owner-actions/country-assignments.json`.

Each indexed entry records the source and destination paths for both derivatives:

```json
{
  "gallery_key": "usa",
  "state": "reserve",
  "from_state": "reserve",
  "from_slug": "unknown",
  "assets": {
    "gallery": {
      "from": "assets/reserve/unknown/photo_900.jpg",
      "to": "assets/reserve/usa/photo_900.jpg"
    },
    "detail": {
      "from": "assets/reserve/unknown/photo_1800.jpg",
      "to": "assets/reserve/usa/photo_1800.jpg"
    }
  }
}
```

## Switching Machines

Preferred handoff:

1. Commit and pull tracked files through Git when the repo is ready.
2. Sync ignored local vault assets separately:

```bash
python3 scripts/sync_local_assets.py david --apply --progress
python3 scripts/sync_local_assets.py max --apply --progress
```

Use the peer name for the mounted machine, or pass the peer repo path directly.

If only the tracked handoff metadata moved through Git and the ignored Reserve assets are stale, future Codex can replay `assets/owner-actions/country-assignments.json`:

1. For each indexed photo, check each derivative `assets.<kind>.to`.
2. If `to` exists, skip it.
3. If `from` exists and `to` is missing, create the destination folder and move `from` to `to`.
4. After replay, regenerate or reload local catalogs as needed with the local owner server path.

There is not yet a dedicated replay command; the index is intentionally explicit enough for a short Python script.

## Before Continuing Review

1. Pull Git changes.
2. Sync or replay ignored Reserve/Hidden assets if needed.
3. Start `python3 scripts/local_server.py 8000`.
4. Open `http://localhost:8000/unknown.html` or `http://localhost:8000/owner.html`.
5. Confirm `assets/owner-actions/country-assignments.json` exists and has a `photos` map.

## Cautions

- Do not commit exact GPS metadata unless explicitly intended.
- Do not commit `assets/reserve/**` or `assets/hidden/**`; they are local vault states.
- Do not rely on browser localStorage for Unknown country assignments. The source of truth is the live file move plus `assets/owner-actions`.
- If a preview is broken, first check whether `reserve-data.json` points to an old `assets/reserve/unknown/` path while `assets/owner-actions` says the photo moved to a country.
