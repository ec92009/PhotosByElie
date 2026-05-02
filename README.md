# PhotosByElie

Static first version of the Photos By Elie site, intended for GitHub Pages at:

`https://ec92009.github.io/PhotosByElie/`

## Version

- Current visible version: `v63.7`
- Versioning follows the canonical MailAssist SOP at `/Users/ecohen/Dev/MailAssist/docs/sops/VERSIONING_SOP.md`, with the local PhotosByElie adaptation in `docs/sops/VERSIONING_SOP.md`.

## Structure

- `index.html`: one-page photo hub with France, USA, Spain, Mexico, and AI collections
- `france.html`, `usa.html`, `spain.html`, `ai.html`: thin gallery shells rendered from shared photo data
- `photo.html`: reusable photo detail and mock purchase page
- `basket.html`: localStorage-backed static basket page
- `photos-data.js`: shared collection, photo, resolution, and mock price data
- `photo-gallery.js`: shared gallery renderer
- `photo-detail.js`: shared detail page and mock basket behavior
- `basket.js`: basket rendering, item removal, clearing, and email checkout handoff
- `shared.css`: copied from the By Elie visual system
- `styles.css`: copied By Elie animation overrides
- `photos.css`: photo-specific layout and carousel styles
- `photos.js`: shared theme toggle behavior for subpages
- `AGENTS.md`: repo-level working preferences and versioning SOP
- `SHOW_ME_SOP.md`: preview/reporting workflow
- `VERSION`: current visible version without the leading `v`
- `docs/sops/`: local SOP copies/adaptations
- `assets/`: shared By Elie logo asset

## Preview

Use the GitHub Pages URL above after pushing to `main`.
