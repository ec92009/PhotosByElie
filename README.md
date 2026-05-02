# PhotosByElie

Static first version of the Photos By Elie site, intended for GitHub Pages at:

`https://ec92009.github.io/PhotosByElie/`

## Version

- Current visible version: `v63.9`
- Versioning follows the canonical MailAssist SOP at `/Users/ecohen/Dev/MailAssist/docs/sops/VERSIONING_SOP.md`, with the local PhotosByElie adaptation in `docs/sops/VERSIONING_SOP.md`.

## Structure

- `index.html`: one-page photo hub with France, USA, Spain, Mexico, and AI collections
- `france.html`, `usa.html`, `spain.html`, `mexico.html`, `ai.html`: thin gallery shells rendered from shared photo data
- `photo.html`: reusable photo detail page; resolution checkboxes sync directly to the basket
- `basket.html`: localStorage-backed static basket page and mock checkout entry point
- `basket-store.js`: shared basket source-of-truth helpers for detail and basket pages
- `photos-data.js`: shared collection, photo, resolution, and mock price data
- `photo-gallery.js`: shared gallery renderer
- `photo-detail.js`: shared detail page, real-image preview support, and automatic basket sync
- `basket.js`: basket rendering, item removal, clearing, and email checkout handoff
- `shared.css`: copied from the By Elie visual system
- `styles.css`: copied By Elie animation overrides
- `photos.css`: photo-specific layout and carousel styles
- `photos.js`: shared theme toggle behavior for subpages
- `AGENTS.md`: repo-level working preferences and versioning SOP
- `SHOW_ME_SOP.md`: preview/reporting workflow
- `VERSION`: current visible version without the leading `v`
- `docs/sops/`: local SOP copies/adaptations
- `assets/`: shared By Elie logo asset and resized Leonardo AI gallery images

## Preview

Use the GitHub Pages URL above after pushing to `main`.

## Current Behavior

- Collections are ordered France, USA, Spain, Mexico, AI.
- The AI gallery uses eight resized Leonardo-generated JPGs from `~/Pictures/Leonardo/2023/06/08/UPSCALE`.
- The basket is the source of truth for selected resolutions.
- Detail pages start with no resolution checked unless that photo is already in the basket.
- Checking or unchecking a resolution on detail immediately updates localStorage.
- Adding the same photo twice does not create a duplicate charge line; one photo maps to one basket row.
