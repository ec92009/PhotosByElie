# PBE-219 implementation candidate

Scope: audit F5/F6 only. No deployment, ticket updates, shared timelog edits,
provider configuration, or canonical Owner/public catalog writes. Parent owns
integration and release identity. Candidate retains the existing v241.0 labels
and query parameters as explicitly requested; this is not a released version.

## Behavior and contracts

- `theme-preference.js` is the shared classic-script bootstrap. Load it before
  `photos.js` or `landing-concept/landing.js`. `byelie-theme` stores
  `system|light|dark`; legacy `day|night` values normalize without losing choice.
  Root datasets retain each design's existing day/night versus light/dark names.
  Missing/invalid preferences use System; matchMedia changes update System only.
- `photosByElieTheme` exposes `set`, `preference`, `resolved`, `normalize`,
  `subscribe` and optional-preference `storage`. Storage denial/quota falls back
  to memory for the current page. This is not durable basket storage.
  Scoped theme keys remain compatibility mirrors/fallbacks; the shared canonical
  key takes precedence across customer surfaces. Cloud APIs still receive their
  existing light/dark shape. Local System is not overwritten by profile hydration.
- Existing landing/display/language/theme events remain. Theme events retain the
  resolved `theme` field and add `preference`. Display values stay usable in
  memory when persistence fails. Account/commerce store formats are unchanged.
- `customer-recovery.js` is loaded before customer initialization and catalog
  scripts on gallery/photo/basket. Pages call `ready()` only after successful
  initialization, or `fail()` on terminal errors. A slow-load timeout exposes
  recovery after 20 seconds; eventual success can still remove that state.
- Failures use EN/FR/ES copy without internal lifecycle/error strings. The shared
  live region announces progress/failure. Partial gallery/media/purchase/basket
  content stays hidden until readiness. Existing lifecycle guards still decide
  which media are available; there is no loader fallback or new catalog API.
- Retry synchronously latches and disables itself, then reloads the current URL.
  It does not invoke checkout, change storage, or reconstruct the route. Query,
  hash and generated static body identity survive via a normal GET reload.
- Basket storage denial shows specific guidance instead of an empty basket.
  Checkout has a synchronous handler latch before any await, releases on terminal
  failures, and stays latched once Stripe navigation starts. Existing checkout
  receipts and persisted basket state are retained.
- Both settings implementations support keyboard dismissal/focus return. The
  custom customer modal wraps Tab/Shift-Tab. Shared About text copies the existing
  version badge, keeping the same release source. Settings/recovery surfaces use
  a .96 opacity floor for readable copy over photographic backgrounds. A narrow
  landing-header wrap keeps translated account labels from displacing the gear.

## Verification

- Focused command: `node --test scripts/customer_resilience.test.mjs
  scripts/landing_concept.test.mjs scripts/pbe_owner_session_web.test.mjs
  scripts/real_estate_output_controls.test.mjs` — 85 passing tests.
- New behavioral tests cover OS changes, explicit theme/reload, malformed values,
  denied/quota storage, cross-tab updates, localized failure/retry, timeout/late
  recovery, unchanged basket/URL, catalog rejection and visibility-503 errors in
  all three real controllers, unreadable basket storage, synchronous reentrant
  checkout, one pending checkout request, failure release and redirect latch.
- `npm test`: 32 pretests and 286 Node tests pass; Python runs 489 tests with
  only the two supplied baseline failures in `native_culling_parity_test`:
  `test_culling_preview_is_bounded_and_collapsible` and
  `test_window_and_preview_layout_persist_between_launches`.
- `npm run validate`: generated Owner API contract current (41 operations,
  14 schemas); publication validation fails closed because the worktree lacks
  an absolute reviewed Owner.sqlite snapshot. No replacement data was created.
- Syntax checks and `git diff --check` pass. `npm ci --ignore-scripts` restored
  declared dependencies locally; package manifests/lockfiles are unchanged.
- Browser checks on the local candidate: desktop landing dialog opens; 320px
  landing dialog and gallery modal fit; EN/FR/ES option labels; OS dark/light
  updates System; actual keyboard Enter/Escape and focus return; Shift-Tab wraps
  inside customer settings; blocked Storage methods still permit language/theme
  changes and notifications; matching About/pill values; gallery failure hides
  media and offers retry; retry returns the same gallery URL to ready.
- At 320px the French landing header originally overflowed (352px); after the
  narrow wrap, scroll width is 320px and the 44px gear is within the viewport.
  Browser CSS was refreshed with a temporary query only in the test tab because
  this unreleased candidate deliberately retains the parent's release version.
- Desktop and mobile screenshots inspected locally. With current candidate CSS
  loaded without cache, settings opacity stays .96 at both slider extremes in
  both themes; computed worst-case contrast against black/white backdrops is
  15.52:1 (Day) and 15.04:1 (Night). This checks the panel text, not every control.
  Settings/recovery opacity at control extremes inspected; general photographic-page contrast across all
  themes/content is not a completed accessibility audit.

## Integration and remaining acceptance

1. Include `theme-preference.js` and `customer-recovery.js` in PBE-216's public
   asset allowlist/build; run the new focused test in the integrated CI suite.
   Neither sibling build/allowlist/CI files nor `photos-data.js` were edited.
2. Integrate PBE-217's catalog candidate independently. No new retry API is needed.
3. PBE-218 changes to `photos.js` SEO code and the photo-ID expression are outside
   this patch's settings and terminal-recovery hunks. Preserve those sibling
   changes when merging. Regenerate static photo/gallery pages from these updated
   shells after integration; do not discard their body identity attributes.
4. Parent must advance the integrated release identity/cache queries using the
   canonical version SOP, regenerate affected artifacts, and confirm About/pill
   values on the actual release. No sibling branch was cherry-picked.
5. Still required before release acceptance: browser 200% zoom, browser-level
   JavaScript-disabled navigation, full contrast check over representative images,
   integrated generated-route retry, integrated network interception (catalog
   failure/visibility 503) followed by recovery, and an authorized buyer rehearsal.
   Failure injection here used real-controller tests plus browser recovery-state
   simulation, not a claimed end-to-end network interception rehearsal.
6. Parent owns YouTrack completion/readback and the reviewed Owner snapshot needed
   for publication validation. No release, purchase, or provider mutation occurred.
