# Codex Daily Review — 2026-05-09

## Architecture
- The shared stores (`basket-store.js`, `liked-store.js`) are the right foundation; the repo would benefit from a `/src` folder to reduce root-level sprawl.
- Worker + static site in one repo is pragmatic; consider a clearer separation (`/site` vs `/worker`) and shared types/constants to avoid drift.

## UI
- Visual system feels cohesive (shared CSS + photo-specific overrides); the “watermark everywhere” posture matches the business goal.
- Owner surfaces (Unknown/Hidden/Owner) are powerful—ensure they stay visually distinct from public pages so features don’t leak accidentally.

## UX
- Keyboard shortcuts + cross-collection prev/next are high-leverage; add a lightweight on-page “shortcuts” hint for discoverability.
- The basket/liked flows are unusually complete for static hosting; keep “what happens next” (email draft / checkout mock) explicit at every step.

## Misc
- If `node_modules/` is present locally, double-check it’s ignored and never committed (repo health + clone size).
- `scripts/validate_publish.js` is a great gate; consider making it the single pre-push hook path for publish safety.
