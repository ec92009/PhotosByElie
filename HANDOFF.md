# PhotosByElie Handoff

## 2026-08-01 — Quick Look carries culling and Review context

- Backstage `0.4.51` build `62` adds contextual Quick Look shortcuts. Culling
  accepts **P**, **H**, and **1–9** for fixture include/exclude, rating, and
  color. Review accepts **A** and **H** for Approve/Hide and retains **U** for
  fixture-local Unpick.
- When a Culling **P** or **H** action no longer matches the active filters,
  Quick Look remains open on the next surviving item, with the same preceding
  fallback used by the grid at the end of the window. Review Approve/Hide uses
  the same in-place continuation when its filters remove the acted item.
- The Quick Look window now has a read-only metadata panel for filename,
  title, keywords, capture time, rating, color, state, and its contextual key
  legend. Verification was state-safe: 51 Swift tests and 27 native UI parity
  tests pass. No real Culling or Review decision was submitted.

## 2026-07-31 — Filtered Culling actions advance to the next card

- Backstage `0.4.50` build `61` keeps sequential fixture-local Culling fast:
  when **P** or **H** removes the focused card from the active filter, the next
  surviving card is selected immediately. At the end of the window, selection
  falls back to the preceding survivor.
- The replacement becomes the new selection anchor and focus, and its preview
  loads without blocking the audited decision or the low-priority Owner
  backfill. If the acted card remains visible under the active filters, the
  existing selection is preserved.
- Verification was state-safe: 51 Swift tests and 26 native UI parity tests
  pass. No real Culling decision was submitted.

## 2026-07-31 — Culling decisions no longer blank the grid

- Backstage `0.4.49` build `60` applies fixture-local **P**, **H**, and **U**
  decisions optimistically in the current Culling window. The affected cards
  leave the active filter immediately, while the rest of the grid, scroll
  position, and pinned controls remain stable.
- Owner backfill is now a coalesced utility-priority refresh. It preserves the
  visible window while loading and swaps in the completed replacement window
  atomically. Only an actual fixture, search, or filter change uses the
  blocking **Applying filters…** state.
- Verification was state-safe: 50 Swift tests and 26 native UI parity tests
  pass. No real Culling decision was submitted.

## 2026-07-30 — Backstage restores its workspace geometry

- Backstage `0.4.48` build `59` remembers the main window's size and screen
  position, the independent Fixtures, People & Access, Culling, and Review
  divider positions, and whether the shared preview panel was collapsed or
  expanded when the app last quit.
- The Culling inspector now displays capture time through seconds (and
  fractional seconds when the source contains them).
- **Select burst** now respects actual adjacent capture-time groups instead of
  treating the whole visible result as one burst. A gap greater than two
  seconds or a missing capture time ends the group; standalone photos are not
  selected, and the second frame of each real group remains the likely keeper.
- Verification was state-safe: 50 Swift tests and 25 native UI parity tests
  pass. No real Culling or Review action was submitted.

## 2026-07-30 — Review can return fixture picks to Culling

- Backstage `0.4.47` build `58` adds fixture-local **Unpick** to Review. Press
  **U** from the Review list or while Review Quick Look is open, or use the
  inspector button, to clear the active fixture pick without hiding or
  globally rejecting the asset.
- Unpicked rows leave the current Review window and return to Culling as
  **Undecided**. The action uses the audited fixture workflow, preserves title,
  keywords, proposals, ratings, colors, and other fixture memberships, and is
  reversible with Review **Undo**.
- Verification was state-safe: 50 Swift tests and 23 native UI parity tests
  pass. No real Review or Culling action was submitted.

## 2026-07-30 — Review is Canvas-ready and resilient to transient UI cancellation

- Backstage `0.4.46` build `57` routes the production Review workspace through
  a dedicated `ReviewView` adapter with Xcode Canvas fixtures for loaded,
  last-good refreshing, initial-loading, and empty states. Preview fixtures
  never connect to Owner or PhotoKit.
- Culling and Review thumbnails are now requested by model-owned retry tasks
  rather than card-lifetime SwiftUI tasks, so scrolling or view replacement
  cannot strand a card with a permanent blank thumbnail after transient
  cancellation.
- Review keeps its last complete window during refresh, ignores benign
  `NSURLErrorCancelled` status checks, and renders initial loading separately
  from a genuinely empty loaded queue. The Culling filter progress label also
  retains a readable full-width layout.
- Verification was state-safe: 50 Swift tests and 22 native UI parity tests
  pass. No real Culling or Review action was submitted.

## 2026-07-30 — Culling filter results are atomic

- Backstage `0.4.45` build `56` invalidates the previous fixture window as
  soon as Culling filters change. The grid stays empty behind an **Applying
  filters…** progress state until the matching Owner query completes; it never
  falls back to the unrelated 2,000 recent Photos cache or stale rows.
- **Select burst** is always available and scopes itself to the complete
  visible filtered window without requiring a focused item. It proposes the
  first, third, fourth, and later frames for hiding while preserving the
  second frame as the likely keeper; Command-click remains available for
  manual refinement before any action.
- Verification was state-safe: 50 Swift tests and 20 native Culling parity
  tests pass. No real Culling decision was submitted.

## 2026-07-29 — AI-review marks preserve PhotoKit Current metadata

- Backstage `0.4.42` build `53` no longer replaces the visible Current title
  or keywords when an audited **Mark for AI review** receipt is retained in
  the current Review window. Requesting or clearing AI work changes only the
  editorial request state.
- Review action receipts now report effective Current metadata: an explicit
  Owner edit when present, otherwise the title and keywords indexed from Apple
  Photos. This keeps PhotoKit-only clues such as a museum name intact without
  copying them into `sidecar_decisions`.
- The requested-AI proposal pass uses the same effective metadata fallback, so
  the preserved Apple Photos title and keywords are included in the AI prompt.
- Verification was state-safe: 59 Python tests, 47 Swift tests, and 19 native
  parity tests pass. No real Review or AI action was submitted.

## 2026-07-29 — A requested revision keeps the previous proposal visible

- Backstage `0.4.41` build `52` keeps the exact superseded proposal visible
  as **Previous proposal** from the moment the orange AI-review question mark
  appears until a replacement proposal is ready.
- Historical context remains display-only: it does not become canonical
  Current metadata and does not qualify an item for the **Proposal Available**
  filter. A new ready or loaded proposal still replaces it immediately.
- The Review response now distinguishes an actionable ready proposal from
  available historical proposal context, so app restarts and queue reloads
  preserve the same evidence as the immediate in-memory transition.
- Verification was state-safe: 58 Python tests and 47 Swift tests pass. No
  real Review or AI action was submitted.

## 2026-07-29 — Second AI passes retain the prior draft as evidence

- Backstage `0.4.40` build `51` keeps canonical Current title and keywords
  separate from the proposal being reconsidered. Requesting AI, hiding, or
  changing AI reasons can no longer promote the displayed proposal into
  canonical metadata; only explicit approval or metadata propagation may do
  that.
- A repeated AI pass now receives the exact proposal superseded by that
  request as `prior_proposal_*` context, together with canonical Current
  metadata and the owner's new reasons and note. Useful title clues therefore
  remain available to AI even when Current was originally empty.
- The Owner audit showed the reported prior proposals were preserved in
  `asset_ai_proposals`; they were not destroyed. The visible disappearance was
  a superseded-draft transition, and those assets had empty canonical titles
  before the pass.
- Verification was state-safe: 58 Python tests and 47 Swift tests pass, and
  the installed app is signed by the stable Apple Development identity. No
  real Review or AI action was submitted.

## 2026-07-29 — Upload Quick View actions advance in place

- Backstage `0.4.39` build `50` gives Upload Quick View explicit **H** and
  **R** shortcuts. They respectively hide the current approved item or return
  it to Review through the existing audited actions, remove that item from the
  fixed Upload tray, advance to the next remaining item, and keep Quick View
  open.
- A loaded Review proposal is now read-only until the owner edits metadata or
  explicitly approves it. Requesting another AI pass no longer promotes the
  displayed proposal into canonical Current title and keywords.
- **Run AI pass now** flushes a pending reason or note request before starting
  the pass, so a shared note on a multi-selection can supersede the prior
  proposal while preserving each item's original Current metadata.
- Verification is state-safe: 39 fixture-pipeline tests, 19 native UI parity
  tests, and 47 Swift tests pass without hiding, reviewing, or uploading a
  real asset.

## 2026-07-29 — AI note autosave no longer cancels its own request

- Backstage `0.4.37` build `48` saves reason toggles after the short interaction
  debounce and saves the optional AI note after two seconds without typing.
- The debounce handle is released before the audited Worker request begins.
  Further typing queues a later save instead of cancelling the in-flight
  URLSession task and surfacing `NSURLErrorDomain -999`.
- If the note changes while an earlier request is completing, the newer local
  draft remains in the inspector and is submitted by the queued save.

## 2026-07-29 — AI review marks save as they are composed

- Backstage `0.4.36` build `47` removes the redundant **Mark N for AI
  review** submit button. Checking or clearing a reason, or editing the
  optional note, saves the AI-review request for every selected Review item
  after a short debounce.
- Either one or more reasons or a non-empty note is a durable AI request. Only
  an entirely empty reason set and empty note clears the request.
- Saving the request refreshes the fixture AI status, so **Run AI pass now**
  becomes available as soon as requested work is acknowledged. It does not
  run inference automatically; inference still waits for that explicit action
  or the scheduled batch.

## 2026-07-29 — Multi-item AI review requests are explicit and actionable

- Backstage `0.4.35` build `46` gives the AI review submit action an explicit
  selected-item count, for example **Mark 17 for AI review**.
- The orange primary action is enabled when one or more selected Review items
  have draft reasons. With no draft reasons, it offers a clear action only
  when the selection contains an active AI request.
- The existing audited batch contract is unchanged: one explicit submission
  records the selected reasons and optional note for every selected item, and
  AI inference still waits for the scheduled pass or **Run AI pass now**.

## 2026-07-29 — Proposal Available rows carry their proposal metadata

- Backstage `0.4.34` build `45` returns the latest durable ready or loaded AI
  proposal with each matching Review row.
- **Proposal Available** can no longer show a contradictory **No proposal**
  card merely because the owner has not pressed **Load proposals** in the
  current app session.
- Reading or filtering Review remains read-only. Proposal status changes from
  ready to loaded only through the existing explicit **Load proposals**
  workflow; manual metadata drafts remain protected from automatic replacement.

## 2026-07-29 — Retained Review actions obey the visible filters

- Backstage `0.4.33` build `44` re-evaluates acted-on Review rows against the
  active State, Proposal Available, Media, and Search filters before retaining
  them as propagation anchors.
- An approved row now disappears immediately when **Approved** is off. It
  remains available for propagation only when **Approved** is explicitly on.
  Consuming a proposal also removes the row from **Proposal Available**.
- Hidden rows follow the same rule: they remain as black-and-white propagation
  anchors only while **Hidden** is selected.

## 2026-07-29 — Review state filters, reusable AI reasons, and Upload navigation

- Backstage `0.4.32` build `43` adds independent **Picked**, **Approved**, and
  **Hidden** filters to Review. They compose server-side with Proposal
  Available, Photos/Videos, pagination, and search across the complete fixture
  queue.
- Once an AI proposal is created, the active AI-request reasons and note reset
  for a fresh editorial pass. The proposal audit row retains the exact reasons
  and note that produced it, so an owner may request another proposal using
  the same reason without losing provenance.
- Upload Quick View now explicitly owns keyboard focus while open. Up/Down
  moves through the currently sorted fixed tray, Space closes the preview, and
  no upload or Review state changes are implied.

## 2026-07-29 — Review filters proposals and media across the complete queue

- Backstage `0.4.31` build `42` adds a **Proposal Available** checkbox to
  Review. It includes durable AI proposals in either ready or loaded state and
  composes with Backfill, Full queue, pagination, and text search.
- Review also adds independent **Photos** and **Videos** checkboxes. Selecting
  either, both, or neither filters the complete fixture queue server-side
  instead of only hiding rows from the visible 200-item window.
- Filter changes reset pagination and selection, preserve any current metadata
  draft, and leave Review decisions unchanged.

## 2026-07-29 — Culling stays below the unified titlebar

- Backstage `0.4.30` build `41` measures the live macOS safe-area inset and
  keeps the complete Culling header below the unified window toolbar.
- The split view subtracts that inset from its own height, so the bottom
  actions remain in bounds instead of the content merely growing taller.
- The behavior applies with the preview panel both expanded and collapsed.

## 2026-07-29 — Authenticated toolbar no longer preserves stale timeout pills

- Backstage `0.4.29` build `40` treats the authenticated Keychain-backed
  session as the toolbar connection authority instead of the last global
  request result.
- A transient request timeout remains available in the screen-specific status
  that produced it, but it no longer occupies the global top-right toolbar
  after authentication has succeeded.
- Culling and Review keep the top-right preview collapse/expand control
  available throughout an authenticated session.

## 2026-07-29 — Review cards compare current and proposed metadata

- Backstage `0.4.28` build `39` shows title and keywords in explicit
  **Current** and **Proposed** columns on every Review card.
- Current values come from the canonical Review item. Proposed values come
  from the loaded AI proposal or unsaved manual draft; cards without either
  show a truthful **No proposal** state instead of repeating current metadata.
- Proposal comparison is presentation-only. Approval, propagation, AI
  requesting, canonical metadata, and publication behavior are unchanged.
- Verification: all 47 Swift tests and 17 native UI contract tests pass.

## 2026-07-29 — Upload selection and review navigation are explicit

- Backstage `0.4.27` build `38` keeps the native Uploads table's Command-click
  and Shift-click selection and exposes the selected-scope action directly as
  **Upload selection…**. The guarded confirmation targets only the current
  selected asset IDs; the fixed visible tray and separate **Publish these N**
  action remain unchanged.
- The Uploads table replaces the redundant filename column with sortable
  keywords. Quick View stays open while Up/Down moves through the currently
  sorted tray, updates the selected row, and discards stale asynchronous
  previews if the owner navigates quickly.
- Approve and Hide no longer force the retained Review row back to the center
  of the scroll area. The current local row ordering and viewport remain under
  the owner's control; explicit keyboard navigation and initial loading still
  scroll intentionally.
- Acceptance remains read-only: selection, Quick View navigation, and visible
  controls may be exercised, but no real upload, approval, or hide action is
  required.

## 2026-07-29 — Native publication can recover the infamous 31 safely

- The 31 repeatedly failed Uploads items were not an R2 outage. Twenty-nine
  were approved in the fixture-aware editorial state while retaining obsolete
  legacy `sidecar_decisions.pick_state = 'undecided'`; two more were blocked
  only by the retired `missing-gallery-signal` bridge gate.
- Native publication now passes its exact, already selected asset IDs into the
  legacy Upload Bridge as an explicit fixture-authorized scope. The bridge
  independently revalidates each ID against an active picked fixture, approved
  global editorial state, a live source asset, a non-archived fixture, and no
  active tombstone before it can queue anything.
- That narrow native path may bypass only the obsolete missing-gallery gate.
  Generic titles, AI/stained exclusions, tombstones, archived fixtures, missing
  assets, and unapproved items remain blocked. Unscoped legacy bridge behavior
  is unchanged.
- A SQLite `.backup` dry run against the latest 31-failure run planned all
  31 exact source asset IDs, with zero metadata blocks and no production R2 or
  Apple Photos mutation. The real retry has deliberately not been started.
- Verification: 103 targeted fixture, connector, publication, and Upload
  Bridge tests pass. A separate pre-existing Apple Photos tombstone-keyword
  assertion still fails in its own test and is outside this repair.

## 2026-07-28 — Deleted R2 coverage requeues instead of blocking publication

- Upload planning now accepts coverage only from `r2_objects` rows whose
  lifecycle state is `current`. A historical successful Upload Bridge ledger
  entry can no longer resurrect an object later marked `deleted_confirmed`.
- This repairs the final-item stall seen after earlier R2 cleanup: missing
  source, 900-pixel, or 1800-pixel objects are queued again instead of being
  incorrectly skipped as already covered.
- With explicit owner authorization, `San Gimignano Towers Across The Hills`
  (`IMG_1175.jpg`) published through native run
  `uplrun-bdd84ccf20fd4dca`: one requested, one live, zero failed. All three R2
  objects and the Apple Photos give-back receipt were freshly verified.
- The stable Uploads tray is now empty and exposes **Load next 200**. The next
  tray remains deliberately unloaded; 843 eligible items remain.
- Verification: the deleted-coverage regression plus the focused publication,
  connector, fixture, and UI suites pass (83 Python tests), as do all 47 Swift
  tests.

## 2026-07-28 — Review propagation no longer renders AI previews inline

- The slow Review propagation was not the two-hour shoot-window query. The
  connector was launching the signed Photos Bridge once per newly requested
  asset and synchronously rendering missing AI JPEGs before completing the
  audited action. The observed 29-item propagation spent about 90 seconds in
  that unrelated preparation.
- `request-ai`, including propagated reasons, now performs only its intended
  atomic Owner-state and audit mutation. Preview capture is deferred until the
  manual or scheduled requested-AI pass actually begins.
- The pass prepares all missing bounded JPEGs with one signed
  `preview-many` bridge request, then generates proposal drafts. Approve, Hide,
  publication, canonical metadata, and Apple Photos remain untouched.
- Focused verification: 83 Python fixture/connector/publication/native-contract
  tests and 47 Swift tests pass. The Max connector was restarted and reports
  healthy as connector `max`, version `1.5`; the installed Backstage UI remains
  `0.4.26` build `37`.

## 2026-07-28 — Upload publication shows its real batch and yields space when idle

- Backstage `0.4.26` build `37` shows the active sequential publication batch
  explicitly, for example **Batch 2 of 4**, alongside the current 50-item
  run's processed, live, failed, and remaining counts.
- The batch number is driven by the actual outer publication loop, not inferred
  from an estimate. A 182-item tray therefore reports four batches:
  50, 50, 50, and 32.
- The detailed run progress and per-asset run table now render only while a
  native publication is active. A completed run no longer occupies the
  Uploads workspace; the candidate tray and the separate legacy inspection
  disclosure retain the space.
- The owner-started 182-item publication was already complete before the signed
  app was replaced: 50 + 50 + 50 + 32 live, zero failures. Installation and
  verification did not start another publication or mutate Review/Culling
  state.
- Verification: 47 Swift tests, 17 native UI contract tests, stable named
  signature, installed bundle version, and normal signed-app launch.

## 2026-07-28 — Native publication resumes verified coverage without duplicate uploads

- The owner-started native publication run `uplrun-90721a8eb2e74359`
  initially stalled behind an Owner SQLite lock, then exposed 50 stale
  `needs-upload` rows whose exact current R2 objects and verified fixture
  receipts already existed.
- The publisher now retries bounded SQLite lock contention, safely requeues
  interrupted items in the exact explicit run, and accepts existing R2
  coverage only when every currently planned object has both a current
  `r2_objects` row and an exact verified delivery receipt. It never treats a
  partial or mismatched receipt as success.
- Fixture schema/backfill initialization now runs once per Owner database
  inode in a process instead of rescanning the full catalog on every
  connection.
- The recovered run completed **50/50 live with zero failures**. All 50 assets
  have verified R2 receipts and verified Apple Photos write-back receipts;
  no duplicate R2 upload was required. Expo then reported 1,643 approved
  items still needing upload and 50 live.
- Focused publication, pipeline, and Culling regression tests pass. This is a
  Python publication-pipeline correction, so the installed Backstage
  `0.4.25 (36)` UI bundle did not require another version bump.

## 2026-07-28 — Upload review uses stable 200-item trays

- Backstage `0.4.25` build `36` loads at most 200 approved, upload-ready
  assets into a stable Upload tray.
- Return to Review and Hide remove successful rows from that tray without
  backfilling from the larger queue. The shown count therefore shrinks as the
  owner reviews it.
- Publish these assets targets exactly the rows remaining in the tray.
  Verified successes leave the tray; independently failed rows remain for
  retry.
- When the tray is empty, **Load next 200** explicitly starts the next review
  batch. Backstage does not silently replace reviewed rows.
- Acceptance remains read-only: verify the signed app copy, batch copy, and
  button states without returning, hiding, uploading, or publishing a real
  asset.

## 2026-07-28 — Review propagation follows the current AI-reason intent

- Backstage `0.4.24` build `35` treats selected AI-review reasons as the
  current action when the main Propagate button is used, even if Approve or
  Hide was the last completed action.
- Propagating `Too generic`, `Add details`, or any other selected reason now
  sends `request-ai` through the existing server-side shoot-window and fixture
  targeting rules. It does not approve the anchor or any propagation target.
- Approve and Hide propagation remain available when no AI-review reason is
  selected. Title and keyword propagation remain separate per-field actions.
- Acceptance remains read-only: verify the selected-reason precedence in the
  normally installed signed build without approving, hiding, propagating, or
  otherwise changing real Review state.

## 2026-07-28 — Lightroom-style Culling filters and exact immediate card state

- Backstage `0.4.23` build `34` replaces the verbose Rating and Color filter
  checkboxes with compact, independently selectable star and color-chip
  controls. Media and Status remain explicit multi-select checkboxes.
- Picked Culling cards now carry a visible flag badge in the upper-right corner
  of the thumbnail.
- Backstage applies the active status, media, rating, and color sets again to
  the returned card window, so a stale or concurrent connector response cannot
  leave Hidden cards visible while Hidden is deselected. Fixture `hidden`
  states now normalize to the rejected Culling state used by the local filter.
- Include, Exclude, and Clear actions now update the affected card state
  optimistically while the existing audited Worker/connector action completes.
  A failed action restores the exact prior card states, so Hidden cards
  desaturate immediately without weakening the durable mutation gate.
- Opening Culling and refreshing its previews no longer start a second Owner
  catalog reconciliation. Full-library reconciliation remains an explicit
  guarded action, and a concurrent SQLite lock is reported as a concise retry
  message rather than leaked job JSON.
- Acceptance remains read-only: verify the controls and existing picked flag
  badges in the normally installed signed build without changing fixture,
  Review, upload, publication, delivery, or client state.

## 2026-07-28 — Fixture reads stay responsive behind slow Owner work

- Backstage `0.4.21` build `32` no longer leaves the fixture tree waiting
  behind an unrelated long-running connector mutation. The connector
  serializes duplicate attempts for the same opaque Worker action and all
  mutations, while allowing a documented set of audited read-only fixture
  actions to execute concurrently.
- The Fixtures screen now distinguishes tree loading from candidate searching.
  Reload tree is disabled only while the tree itself is loading, and the
  candidate progress indicator appears only for an explicit candidate search.
- The existing Worker action remains the authorization, audit, and durability
  gate. No direct local fixture operation or photo-state mutation was added.
- Verification on Max requires the normally installed signed build to load the
  existing 20-node fixture hierarchy without changing photo, Review, upload,
  publication, delivery, or client state.

## 2026-07-28 — Stable Backstage signing for Keychain access

- Backstage `0.4.20` build `31` no longer installs an ad-hoc-signed release by
  default. The build selects a Developer ID Application identity when
  available, otherwise an Apple Development identity, and preserves
  `PBE_CODESIGN_IDENTITY` as the explicit override. Release builds fail closed
  when no stable identity exists; `PBE_ALLOW_ADHOC_SIGNING=1` is restricted to
  explicit disposable builds that must not be installed.
- Root cause: the previous installed Backstage bundle was ad-hoc signed. Its
  CDHash changed after every rebuild, so the login Keychain could not recognize
  later builds as the same trusted application even though the bundle ID was
  unchanged. The credential item remains intact.
- The first launch of the stable build may require one manual **Always Allow**
  authorization for the existing item. Elie must enter the login-keychain
  password directly in the macOS dialog; no agent, script, log, or automation
  may receive it. Later launches should remain quiet because the named
  signature produces a stable designated requirement.
- Verification on Max: the normally installed `0.4.20 (31)` build passed
  deep/strict signature validation with hardened runtime, Team Identifier
  `CB7FE399AL`, and the stable Backstage designated requirement. It was quit
  and reopened twice without launching `SecurityAgent` or presenting another
  Keychain prompt. The existing item was inspected without returning its
  secret and was not deleted, replaced, or otherwise mutated.

## 2026-07-28 — Immediate visible Culling filters

- Backstage `0.4.19` build `30` replaces the four Culling filter pull-downs
  with visible, independently selectable checkbox groups for media, fixture
  status, rating, and color. Checkbox changes apply immediately; search applies
  after a short typing debounce. The obsolete Apply button is gone.
- Rapid filter changes cancel the prior local request and use a monotonic
  response guard, so a slow older Owner response cannot replace the newest
  filter result. Hidden-only windows retain the exact server-side fixture
  scope and now render their thumbnails in black and white.
- The Culling split view and thumbnail scroller claim the available vertical
  height while retaining the pinned header and action footer. This removes the
  large dead area after a user-driven vertical window expansion.
- Automated verification passes: 46 OwnerCore tests, 15 native Culling source
  contract tests, the full 156 Node + 169 Python repository suite, and
  publication validation. Signed-app acceptance must remain read-only.

## 2026-07-28 — Retained Review decisions and Upload keyboard inspection

- Backstage `0.4.18` build `29` keeps cards approved or hidden during the
  current Review session instead of immediately re-querying them out of the
  Backfill window. Approved cards show the existing 30-point green check;
  hidden cards remain in place in black and white. Either state remains a
  valid anchor for the deliberate Propagate action until Review is left or
  explicitly reloaded.
- Upload supports `R` for the guarded Return to Review action, `H` for the
  guarded fixture-hide action, and Space for a reversible local preview.
  The preview includes the image, canonical title, canonical keywords,
  capture time, and filename; Space closes it. Successful Return or Hide
  actions remove their rows from Upload without deleting source files.
- Verification is source/test/build only until the installed signed app is
  inspected read-only. Codex must not approve, hide, propagate, return,
  upload, publish, or otherwise alter real photo state during acceptance.

## 2026-07-28 — Explicit visible Upload window

- Backstage `0.4.17` build `28` permanently states how many approved
  needs-upload items are loaded in the native Upload table, how many eligible
  items remain outside that window, and that the server window is the oldest
  eligible work by upload-readiness time. Column sorting rearranges only the
  loaded rows.
- **Publish these N…** publishes the exact loaded window the owner reviewed.
  The app preserves the proven maximum of 50 assets per upload run by draining
  that snapshot through sequential batches, with aggregate progress and
  independently retryable failures. The confirmation names the exact loaded
  count and reiterates that upload makes each verified asset live.
- Automated verification passes: 46 OwnerCore tests, 13 native UI source
  contract tests, and 6 native publication pipeline tests. Signed-app
  acceptance remains read-only until the owner deliberately confirms a
  publication; Codex must not activate this control.

## 2026-07-28 — Sortable Upload queue and audited return to Review

- Backstage `0.4.16` build `27` gives the native Upload queue sortable Title,
  File, Captured, State, and Error columns, standard Command/Shift
  multi-selection, and 50-point PhotoKit thumbnails.
- Selected approved rows can be returned to Review after an explicit
  confirmation. The action uses the existing audited Review transaction,
  preserves fixture placement plus canonical title and keywords, clears upload
  readiness, removes successful rows from Upload immediately, and remains
  undoable. Live or non-approved assets fail safely. A slow follow-up queue
  refresh cannot make the successful transition look like a failure.
- Automated verification passes: 46 OwnerCore tests, 54 focused Python tests,
  and full publication validation. Signed-app acceptance must remain
  read-only: sort columns, select/deselect rows, inspect thumbnails, and open
  but do not confirm the Return to Review dialog.

## 2026-07-28 — Multi-select Culling filters and native Upload eligibility

- Backstage `0.4.14` build `25` replaces the mutually exclusive Culling
  filter pickers with independent checkbox menus. Media, fixture decision,
  rating, and color each accept multiple selected values; choices are ORed
  within one menu and the four menus are ANDed together. The final checked
  value in a menu cannot be removed accidentally.
- The bounded fixture Culling query accepts multiple decision states in one
  read-only request, including combinations such as Undecided + Picked or
  Picked + Hidden. Clear restores all media, ratings, and colors while keeping
  Undecided as the default decision view; Review picked selects only Picked.
- Uploads now loads a read-only, fixture-scoped native eligibility plan instead
  of presenting only the empty legacy receipt-recovery table. The plan
  distinguishes picked items still awaiting Review, Review-approved items that
  need upload, already-live items, and blocked items before either guarded
  publish action is available. The live Expo plan at implementation time was
  2,062 picked, 130 awaiting Review, 1,932 approved/needs upload, and 0 live;
  these counts are expected to change with later owner decisions.
- Verification passes: 46 OwnerCore tests, 156 Node tests, 164 Python tests,
  publication validation, release signing, and the installed version check.
  The native desktop-control pipe closed before returning the final
  accessibility tree, so signed-app visual acceptance of the checkbox menus
  and Upload summary remains the next read-only checkpoint. No Culling,
  Review, upload, publication, delivery, access, or client state was changed.

## 2026-07-28 — Culling pane containment candidate

- Backstage `0.4.12` build `23` removes the layout-affecting `GeometryReader`
  that wrapped the Culling thumbnail scroller. Grid-width measurement now runs
  in a transparent background, so the thumbnail viewport participates as an
  ordinary flexible child between the fixed header and fixed action footer.
- The complete left pane is a conventional top-aligned flexible stack with no
  exact-height geometry wrapper. This prevents the grid from painting over the
  header or pushing its own content and action footer outside the visible pane
  while preserving adaptive density measurement.
- Automated verification passes: 12 focused native Culling tests, 46
  OwnerCore tests, the complete 156 Node + 164 Python repository suite,
  publication validation, release signing, and the installed version check.
  Human screenshots of `0.4.12 (23)` confirm the complete header, first
  thumbnail row, and complete action footer remain visible together.
- During acceptance, Elie independently applied two real Expo Include batches.
  The app moved from 1,941 to 2,062 picked photos and showed two reversible
  steps. Codex did not perform or reverse those decisions. No upload,
  publication, delivery, access, or client action occurred.

## 2026-07-28 — Current Culling window and pinned controls

- Backstage `0.4.9` build `20` keeps the complete Culling header and complete
  decision/action footer outside the thumbnail scroller. The thumbnail viewport
  has explicit top padding and resets to its top when the fixture, view, page,
  or first visible asset changes.
- Before loading a fixture-scoped Culling window, Backstage now reconciles the
  recent 45-day PhotoKit slice through the signed Owner connector. This prevents
  the current PhotoKit preview set from being replaced by an older Owner-index
  window and keeps the displayed assets and culling decisions on one index.
- The Photos Bridge installation records a source SHA-256 fingerprint, so a
  stale signed helper is rebuilt even when filesystem mtimes are misleading.
  Date-bounded reconciliations also accept a valid empty PhotoKit result.
- Verification passes: 164 repository tests, publication validation, shell
  syntax checks, the focused native Culling and connector suites, 46 OwnerCore
  tests, release signing, and the installed app version check. Final native
  visual acceptance remains read-only/no-save.

## 2026-07-28 — Shared Backstage preview-panel control

- Backstage `0.4.5` build `16` removes the persistent green `Connected`
  indicator after authentication succeeds. Non-connected and error states
  remain visible in the top-right toolbar.
- Culling and Review now share a top-right preview-panel toggle modeled after
  the Codex UI. The toggle remains present when the panel is collapsed, so the
  owner always has an explicit way to restore it.
- The former Culling-local toggle is removed. Both the bounded Culling preview
  and the Review editorial inspector animate in and out without resizing the
  app window.
- Acceptance remains read-only/no-save: do not change Culling/Review state,
  metadata, Waste Basket, uploads, publication, delivery, access, or clients.

## 2026-07-28 — Backstage Culling and Review interaction polish

- Backstage `0.4.4` build `15` animates Culling density changes, bounds the
  inline preview to a compact 220–360 point pane, and lets the owner collapse
  or restore that pane without resizing the window.
- Review title and keyword edits now autosave after a short pause. Each field
  has its own compact down-arrow propagation control and the redundant
  `Save T/K` button is gone.
- AI reason checkboxes are local mark-form state until `Update AI review mark`
  is chosen. That action only places the item in the deferred queue; AI work
  runs separately in a scheduled batch or when `Run AI pass now` is chosen.
  Clearing the last reason no longer leaves Approve, Hide, and Propagate
  disabled. Metadata edits do not overwrite the last Approve, Hide, or Request
  AI action, so the main Propagate action remains available after approval.
- Full Review retains fixture-hidden items for inspection while Backfill
  remains unresolved picked work. Approved thumbnails show a 30-point green
  check, AI-marked thumbnails show a 30-point question mark, and hidden
  thumbnails render in black and white. Propagating Approve, Hide, or the AI
  mark applies the same durable state to the bounded two-hour shoot targets.
- Acceptance remains read-only/no-save: do not change Culling/Review state,
  metadata, Waste Basket, uploads, publication, delivery, access, or clients.

## 2026-07-28 — Backstage Culling density containment

- Backstage `0.4.3` build `14` keeps Culling density changes inside the
  thumbnail viewport. `+` enlarges thumbnails by removing a column, while `−`
  adds a column only when every card can remain at least 84 points wide.
- The viewport distributes its width across the current column count. A wider
  window makes those columns wider; a narrower window shrinks them to 84
  points and then reduces the column count without changing the window size.
  A focused source-contract regression and all 45 OwnerCore tests pass.
- Acceptance is limited to grid-density and Fit/Fill display state. No
  Culling/Review decision, metadata, Waste Basket, upload, publication,
  delivery, access, or client state may be changed.

## 2026-07-28 — Max native Backstage all-screen polish

- PBB-65 covers a read-only tour of all eleven Backstage workspaces and a
  consolidated native usability pass. The release candidate is Backstage
  `0.4.2` build `13` on `codex/david-pbb-43-review`.
- The pass replaces raw action errors with useful operator messages, keeps
  Culling and Review controls legible at the compact `1120 x 720` content
  minimum, adds loading and empty-state guidance across long-running
  workspaces, exposes Activity timing/detail, and guards Upload publication
  actions with explicit confirmation. Overview now distinguishes the helper
  protocol from the app version and abbreviates the device credential; People
  & Access preserves readable group names and archived state.
- Verification passes: 44 native OwnerCore contract tests, 7 native culling
  parity tests, 30 fixture-pipeline tests, release signing, and a read-only
  visual tour of every sidebar workspace. Acceptance selected sidebar
  destinations only; it did not make a real Review/Culling decision, save
  metadata or policy, change the Waste Basket, upload, publish, deliver, alter
  access, or perform a client action.
- Review and Culling thumbnails now resolve the real local PhotoKit identifier
  from cloud-backed catalog records instead of passing their cloud asset ID to
  Photos. The regression is covered for both native windows, and a real
  `IMG_4849.jpg` preview was rendered read-only from Photos with the corrected
  identifier.
- During the first accessibility fallback, six AI-reason toggles were
  accidentally generated for the already-selected `IMG_4849.jpg`. The final
  semantic state was verified to match the initial state exactly:
  `unreviewed`, no AI reasons, no request timestamp, and unchanged
  title/keywords/approval. The audit records remain. Subsequent navigation used
  only the sidebar row's `AXSelected` attribute and was read-only.

## 2026-07-27 — David to Max PBB-43 native Review handoff

- PBB-29 and PBB-33 are Verified in YouTrack after David's completed native
  fixture-policy acceptance. The accepted UI is Backstage `0.3.0` build `10`;
  the final implementation commit is `947d39cf6` and the durable closeout
  commit is `80194c7d8`.
- The next epic is PBB-43, `[EPIC] Complete native Backstage Review and
  propagation workflow`, beginning with child PBB-44's fixture-aware Review
  queue and editorial-state contract. David claimed PBB-43/PBB-44 only long
  enough for read-only discovery, then stopped before implementation when Elie
  moved the active COO session back to Max.
- The clean transfer branch is `codex/david-pbb-43-review`. Max should fetch
  that branch, verify the pushed handoff head, add its YouTrack claim note, and
  reconcile PBB-44 against the existing Review machinery before changing code.
  Continue one verified child at a time through PBB-45, PBB-46, PBB-47, and
  PBB-48; PBB-48 explicitly requires hands-on proof on Max.
- Existing Review behavior is concentrated in `scripts/fixture_pipeline.py`,
  `native/PhotosByElieBackstage/Sources/OwnerCore/FixtureWorkflowService.swift`,
  `native/PhotosByElieBackstage/Sources/OwnerCore/BackstageViewModel.swift`,
  and
  `native/PhotosByElieBackstage/Sources/PhotosByElieBackstage/PhotosByElieBackstageApp.swift`,
  with coverage in `scripts/fixture_pipeline_test.py` and the Swift
  `OwnerCoreTests`. Discovery found substantial queue, editorial-action, and
  propagation support already present; treat the tickets as a contract and
  evidence reconciliation exercise before assuming missing implementation.
- David made no Review decision, propagation change, publication, delivery,
  upload, or client-facing action during discovery. No blocker or unresolved
  human decision is known at handoff.

## 2026-07-27 — David PBB-29 acceptance and Owner bootstrap

- David accepted Max's exact `d2dbd6fbb` release-candidate head in the isolated
  `codex/david-pbb-29-acceptance` worktree. David's dirty/divergent primary
  checkout and its untracked `GAMEPLAN.md` remain untouched.
- David pushed focused acceptance follow-ups ending at `947d39cf6`:
  `16f8438a9` keeps fixture search compatible with David's Python 3.9 runtime;
  `7fc3e48b5` makes P/H/U strictly fixture-local while reserving X for the
  global reversible tombstone; `0d461bb46` separates configured overrides from
  effective inherited policy; later checkpoints route fixture actions through
  the enrolled local connector, make fixture-tree reads non-mutating, remove
  connector I/O throttling, bound the asset workspace, suppress harmless
  cancellation noise, and give the policy editor adaptive one/two-column
  geometry with fixed-width, spacer-aligned menu controls.
- Verification passes on David: the release candidate's 156 Node tests,
  165 Python discovery tests, 43 Swift tests under Xcode 26.6, focused
  fixture-policy/culling tests, the reversible native parity rehearsal, Owner
  API contract generation, and publication validation.
- Backstage `0.3.0` build `10` was built from the corrected acceptance branch,
  ad-hoc signed, relaunched on David,
  and retained its independently revocable Keychain enrollment. Codex's native
  Mac-control pipe still closes before returning a Backstage screenshot, so
  human Screen Sharing and a local read-only desktop capture supplied the
  visual evidence. The final build loaded the real 20-node fixture tree,
  selected Expo, and presented the population contract, configured overrides,
  effective revision/status, and all six policy dimensions legibly with
  aligned pull-downs. No configuration was saved. PBB-33 and parent epic
  PBB-29 are Verified in YouTrack.
- David's stale 21-table, fixtureless Owner database was reconciled only through
  the documented private-R2 Max-to-David path. Max created a consistent SQLite
  `.backup`, uploaded
  `photosbyelie-private/owner-sync/snapshots/max/Owner-latest.sqlite.gz`, and
  reported gzip SHA-256
  `195d0865c89e2b3f38a59b451058167303558e4900aabe195224f5cb868b8933`.
  David independently verified that hash, `gzip -t`, decompressed integrity,
  50 tables, and 20 fixtures before replacement.
- The pre-restore David database remains recoverable as
  `assets/owner-actions/Owner.sqlite-before-max-sync-20260727T070336Z` and the
  original file is retained beside it with the
  `Owner.sqlite-pre-max-sync-original-20260727T070336Z` prefix. The restored
  database matches the verified snapshot byte-for-byte, passes integrity,
  contains 20 fixtures, 15 culling snapshots, 20,229 fixture decisions, and the
  applied `fixture-policy-v1` receipt. David's connector was restarted and its
  local status endpoint reports `ok=true`.
- No real culling decision, policy save, Waste Basket change, publication,
  upload, delivery, or client communication occurred during acceptance.

## 2026-07-27 — PBB-29 fixture policy release candidate

- Release candidate: Backstage `0.3.0` build `9`; branch
  `codex/pbb-19-native-backstage`.
- Fixtures now carry an explicit population contract (`curated`,
  `rule-based`, or `parent-subset`) and independent visibility, search,
  retention, delivery, download, and commerce policies. Saved culling
  snapshots freeze the effective policy revision alongside their immutable
  asset order.
- Backstage exposes those controls in the native Fixtures workspace. The
  publication, R2 retention, Apple Photos give-back, delivery, and catalog
  paths enforce the same effective policy and fail closed when a fixture has
  no valid contract.
- The live Owner database migration `fixture-policy-v1` was applied through
  the supported migration path with a pre-mutation backup and durable receipt.
  Thirteen existing fixtures were migrated. Verified examples: Expo remains
  public/searchable/retail; RE and La Concha remain private/granted
  paid-service fixtures; Friends and Family and Blood remain private/granted
  free-sharing fixtures.
- Verification passes: 156 Node tests, 142 Python tests, 40 Swift tests,
  focused fixture-policy/publication/delivery tests, API contract validation,
  publication validation, and the reversible native parity rehearsal. The
  rehearsal left Owner SQLite and guarded public/client artifacts unchanged.
- `/Users/ecohen/Applications/PhotosByElie Backstage.app` is signed,
  installed, and running as `0.3.0` build `9`; the Max connector is healthy.
  Automated and reversible acceptance is complete. Final hands-on visual
  acceptance remains open because the Codex Mac-control channel repeatedly
  closed before returning a Backstage screenshot; do not describe that visual
  check as complete until it is performed.

## 2026-07-26 — PBB-34 native culling parity

- Release candidate: public site `v147.6`; Backstage `0.2.5` build `8`.
- Branch: `codex/pbb-19-native-backstage`.
- PBB-35 through PBB-42 complete the native Sidecar-parity contract:
  hierarchical fixtures and breadcrumbs; thumbnails and inline previews;
  immutable-pool search, filters, counts, picked-only review, and 200-item
  paging; bounded audited decision batches with progress, cancellation, and
  exact undo; burst selection; keyboard shortcuts; and explicit Metadata and
  Upload handoffs.
- The saved Expo pool opens as exactly 1,140 immutable ordered assets. A
  read-only live rehearsal reported 1,005 picked, 132 undecided, and 3
  rejected; filtered Ronda to 60 matches; paged to 201–400; switched to the
  1,005-item picked-only review; prepared a thumbnail and 1,600 by 1,200
  inline preview; and showed `RE / La Concha` in the native hierarchy. No
  culling decision, upload, publication, or client action was performed.
- Verification: 156 Node tests, 127 Python tests, 33 Swift tests, native owner
  parity rehearsal, native cutover audit, API contract check, and publication
  validation all pass. The production root's stale `v147.4` landing asset
  cache keys were aligned with the existing `v147.6` release while clearing
  the canonical test gate.
- `/Users/ecohen/Applications/PhotosByElie Backstage.app` is signed, installed,
  and running as version `0.2.5` build `8`. Photos Bridge remains the sole
  signed headless Photos writer.

## 2026-07-25 — PBB-19 native Backstage cutover

- Release candidate: `v147.6`; Backstage `0.2.3` build `6`.
- Branch: `codex/pbb-19-native-backstage`.
- Backstage is the sole visible operator app on Max. Photos Bridge remains a
  signed headless helper; visible Owner and Sidecar apps were moved to the
  reversible archive documented in
  `docs/architecture/backstage-native-cutover-2026-07-25.md`.
- Port `8011` is retired. The connector remains healthy on `8766`, and its
  legacy Sidecar launch route returns `410` unless
  `PBE_ENABLE_LEGACY_SIDECAR=1` is set for a controlled rollback rehearsal.
- Verification at this checkpoint: 278 repository tests, 28 Swift tests,
  native parity rehearsal, contract validation, and read-only cutover audit
  all pass.
- Backstage `0.2.3` build `6` makes the detail workspace fill its navigation
  pane and gives the Culling scroll region explicit flexible height. This
  prevents both fixture-pool and full-library culling rows from collapsing.
- Fixtures now reload saved immutable culling snapshots from Owner SQLite
  after an app restart and can open the selected snapshot directly in native
  Culling. Snapshot recovery no longer depends on in-memory UI state.
- Live native proof reopened Expo snapshot `pool-4ef5c086edc741dd` as
  `Native selection` with exactly 3 immutable assets and 3 preserved decisions.
  The first row was selected for preview only; no decision was changed.
- Worker version `3b6d56c8-2347-4d0d-969b-b0b61e21c7c5` fixes Backstage's
  full-library `D1_ERROR: too many SQL variables` by keeping D1 decision
  queries to 80 bound IDs per statement. The 65-test Worker regression pass,
  15 fixture pipeline/connector tests, and 29 Swift tests pass.
- Local ad-hoc Backstage builds now carry the stable designated requirement
  `identifier "com.photosbyelie.backstage"` instead of a per-build cdhash.
  Max needs one Photos re-approval after this transition; later local updates
  retain the same TCC identity.
- Signed Photos Bridge health reports `photoAccess=authorized`; a read-only
  LaunchServices album inventory succeeded. Never substitute a raw helper
  executable or a second writer.
- GitHub Pages published commit `42e9bc07`; the public home, gallery, photo,
  Owner, ACS, and Real Estate surfaces all returned HTTP 200 with the exact
  `v147.6` badge.

Use this when moving work between Max, David, or the laptop.

For Owner DB state and other sensitive Max/David handoffs, follow
[`docs/sops/MAX_DAVID_SYNC_SOP.md`](./docs/sops/MAX_DAVID_SYNC_SOP.md).
GitHub carries code, safe metadata, SOPs, and handoff notes; private Owner DB
snapshots and client artifacts move through private R2; SSH/Codex Remote SSH is
for remote execution.

## Current Handoff: 2026-07-19 Universal Fixture Access Control

- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Branch: `codex/universal-fixture-pipeline`
- Public site: `https://photos-by-elie.com/`
- Local preview: `http://localhost:8000/`
- Owner intake URL: `https://photos-by-elie.com/owner.html`
- Current visible build: `v147.5`
- Sidecar local build: `v126.6`
- Public catalog source of truth: `assets/catalog/photosbyelie.sqlite`
- Owner workflow source of truth: ignored local `assets/owner-actions/Owner.sqlite`
- The PBB-1 API and PBB-11 native Backstage implementation have completed the
  production cutover. Web/Python tests (155 Node + 118 Python), 22 Swift tests,
  API contract generation, and publication validation pass. The reversible
  PBB-18 parity rehearsal is checked in and the Owner page now declares
  `data-owner-writer="backstage"`.
- `/Users/ecohen/Applications/PhotosByElie Backstage.app` is built and
  codesigned. Native app version `0.1.1` coalesces startup authentication with
  saved-workspace loading, automatically renews an expired access token once,
  retries the rejected request, and replaces raw API envelopes with readable
  errors. Elie explicitly approved enrolling Max on 2026-07-25, and Max is
  now enrolled with an independently revocable device credential stored in
  Keychain. A cold relaunch refreshed the native session from Keychain and the
  Fixtures screen loaded the current 20-node hierarchy without mutation.
  Read-only native rehearsals also loaded 18 people, 8 groups, 50 completed
  activity rows, and the Uploads, Delivery, and Publication workspaces without
  starting a job. Waste Basket now requests only recoverable hidden rows: the
  installed app loaded all 29 recoverable items while reporting 6,110
  permanently discarded records separately, avoiding the former 6,139-row
  SwiftUI payload. No lifecycle item was restored or discarded during this
  rehearsal.
  Max granted explicit Photos access and the installed app indexed 2,000
  recent Photos items. Worker action
  `owner-action-a8171125-babf-48e4-bc9d-deafec16b699` then completed a
  read-only `metadata-read-many` dry-run for two eligible items with no read
  errors, no previews, no publication or client message, and no byte change to
  `Owner.sqlite`. `v147.5` therefore makes Backstage the active writer.
- The audited dry-run also exposed and fixed a connector reporting bug that
  overwrote `readOnly: true`; the connector now preserves the operation result.
  Metadata-only reads explicitly suppress PhotoKit preview generation.
- `v147.5` makes the signed Backstage app the active Owner writer. Browser
  Owner retains authentication, enrollment, access review, connector health,
  and audit. Rollback remains one reviewed `data-owner-writer="browser"`
  change followed by normal versioned publication.
- `v147.4` publishes the Owner-only Backstage enrollment panel and the
  reversible writer gate while deliberately retaining the browser Owner as the
  active writer until native enrollment and read-only readiness checks pass.
- `v147.3` corrects the 12-photo April 2018 La Jolla Cove cohort that had
  inherited the title `Nerja, beach` and Spain keywords. The photos remain in
  USA with corrected La Jolla, San Diego, California metadata.
- `v147.2` tightens fuzzy place search so Seville/Sevilla and small typos
  still match, while Paris “Hôtel de Ville” photos no longer leak into
  Seville results.
- `v147.1` keeps Search and all gallery filter controls in place while results
  update. Typing ordinary letters such as `P` no longer scrolls the first
  matching photo into view and makes the filter panel appear to disappear.
- `v147.0` turns the homepage image-use guide into three illustrated cards
  using the approved PhotosByElie compositions for wall art, licensing
  contexts, and location provenance. Generic card copy is removed and the
  useful provenance note now sits in the section heading.
- `v146.3` replaces the public gallery density slider with a compact segmented
  minus/plus control and presents Fit/Fill as a matching split pill. Density,
  URL persistence, image-fit persistence, keyboard shortcuts, translations,
  and boundary disabling remain intact.
- `v146.2` integrates authenticated `Shared with me` access into the standard
  Expo gallery and photo-detail path. Authorized fixture IDs resolve to the
  canonical public catalog objects, so Avery's 20-photo parent set now has the
  same filters, metadata, resolutions, likes, basket, and detail navigation as
  every country gallery. Signed-in account headers expose a subtly accented
  `Shared with me` pill; the old stripped viewer redirects to the canonical
  gallery route.
- `v146.1` respects hierarchical photo subsets in authenticated shared
  delivery. Avery's Family and Blood memberships remain in ACS, but their
  10- and 5-photo sets are wholly contained by Friends and Family and therefore
  no longer render as duplicate galleries; the real Avery alias sees one
  Friends and Family circle with 20 unique photos. A nested fixture that adds
  any unique photo remains visible.
- `v146.0` completed the Friends and Family fixture rehearsal as a real
  authenticated delivery path. The three private circles contain 20 / 10 / 5
  cloud-addressable, watermarked photos; `ec92009pt@gmail.com` is the Avery
  Morgan test alias and belongs to all three groups. `shared-galleries.html`
  exposes only assigned catalog previews after Google login; anonymous users
  receive no fixture data. Migrations 0010 and 0011 are applied remotely.
- `v145.20` fixes the apparently inert Real Estate finished-product shelf. A
  repeated scoped-account sync had been reapplying language/theme preferences,
  redispatching the language event, and overflowing the browser call stack when
  opening a product. Scoped session updates are now idempotent; the shelf also
  owns its click handler as soon as rows render and reports download startup
  immediately. A headed browser rehearsal opened the mock Corine product
  directly on Output without a new recursion error. No Worker change is needed.
- `v145.19` fixes the shared Account sign-out path when Google and Real Estate
  sessions are both active. The browser clears its scoped gallery state before
  leaving, `/auth/logout` expires both Worker cookies, and the user returns to
  the public account screen rather than appearing to stay signed in. Production
  Worker version `de33a8a0-59d9-4c5d-976c-c937b59f818e` is live; its logout
  response was verified to emit separate expired Google and Real Estate
  cookies before redirecting to the public account screen.
- `v145.18` adds reusable no-login Real Estate delivery links without exposing
  private R2 objects. The Output page and each ready shelf product can mint and
  copy fresh PDF, video, and Originals bearer links with the standard 30-day /
  100-download policy. Link creation still requires the gallery session;
  recipients need only the opaque links. Production Worker version
  `d3daa92e-8af7-4fc1-a2dc-10a8a543c98a` serves the authenticated mint route
  and the existing public bearer-download route.
- Worker v115 (`3ce5d7d3-f246-4f45-8381-1284e6f8c476`) keeps long Real
  Estate video renders alive by giving Browser Rendering a ten-minute keepalive
  and polling render status every ten seconds instead of leaving one inactive
  wait open. Production replay of Corine's 15-photo `Multiple-260722-1`
  completed through finalization and exposed `Download video`.
- `v145.17` routes every ready Real Estate PDF, video, and Originals action
  through one Mac-aware download helper. Supported Mac browsers open the native
  Save dialog before transfer and stream to the chosen file; phones and browsers
  without `showSaveFilePicker` retain their existing download behavior.
- `v145.16` promotes Originals to a persistent R2-backed third output beside
  PDF and Video. Output and shelf controls share Queue, pending, and Download
  states; the ZIP container remains an implementation detail rather than the
  client-facing product name.
- `v145.15` tracks JPEG ZIP activity by saved-product ID so only the pressed
  shelf action shows preparation and becomes that product's download.
- `v145.14` removes the full source-photo-grid rebuild from saved-product shelf
  entry/return navigation, renders only the active surface, and caches loaded
  product manifests for repeat opens during the session.
- `v145.13` normalizes every cloud slideshow video through an explicit
  orientation-aware Media transform before MP4 output, preventing VP9/Opus
  browser recordings from masquerading as iPhone-incompatible MP4 files. A
  prepared product JPEG ZIP now becomes a direct Download JPEGs action for
  repeat downloads in the current session. Worker version
  `5c6dda2b-e7fb-4028-a67a-5fb07ad719bb` is deployed; fresh Corine output
  `assembly-20260722T181605Z-070956180e-video` was downloaded directly from R2
  and verified as H.264 High / AAC-LC / 1280x720.
- `v145.12` replaces the generic signed-in face icon with the account's first
  initial, preferring the available name and falling back to the email address.
- `v145.11` gives every Real Estate finished product its own ZIP JPEGs action
  using the product's saved manifest, removes the redundant Cloud saved badge,
  and avoids the full 99-card rebuild when switching language or theme on a
  phone.
- Static catalog publication is reconciled through `v143.6`: lifecycle-hidden
  rows `001-3f15265af4`, `001-87f0bfdea3`, and `001-eddc9ddb4b` are absent from
  public SQLite, the generated Worker catalog, homepage data, Expo manifest,
  and media sidecar. The public catalog and sidecar now agree at `3,551` rows,
  and `node scripts/validate_publish.js --external-media` passes.
- `owner.html` is the authenticated cloud Owner surface. `new-owner.html` is a
  compatibility redirect back to the canonical Owner URL; the localhost Owner
  Python web UI is retired as the normal control plane.
- `v143.10` removes the in-app browser's blocked HTTPS-to-localhost Waste
  Basket hop. Manage Waste Basket opens the authenticated same-origin Owner
  review; recoverable items load only for Owner, and restore or confirmed
  permanent-discard mutations run through the Max connector.
- `v143.9` keeps Manage Waste Basket clickable even when the browser's
  localhost discovery probe is blocked. The click tries Max's local connector
  directly and was verified to reach the seven-item private Waste Basket;
  nothing was restored or discarded during proof.
- The v143.9 regression suite passes. Publish validation separately reports 11
  newer hidden/discarded rows still present in the public catalog and Expo
  manifest; that existing lifecycle-publication drift was not folded into this
  button repair.
- `v143.8` puts the Waste Basket first on Owner and opens only the Waste Basket
  and Owner queue by default. Country galleries and the local Waste Basket now
  extend the original selection with Shift + Arrow; the basket also separates
  keyboard focus from selected photos and reports selected and total counts.
- The new Build a Fixture card is the canonical intake/orchestration surface.
  It creates recursive root/child fixtures, searches the indexed library without
  mutation, snapshots stable culling pools, opens the existing Sidecar with only
  its candidate scope changed, and reviews versioned R2/Apple Photos receipts.
  The old Apple Photos to Real Estate card is collapsed as a compatibility lane.
  Architecture and safety boundaries are in
  `docs/architecture/universal-fixture-pipeline.md`.
- The live La Concha migration now has Apartment 1 (70 sources), Apartment 2
  (66), and Common children Street (3), Main lobby (3), Pool (5), and Tennis
  court (3). Those are immutable local snapshot pools backed by the supported
  Apple Photos bridge refresh. Corine's existing gallery/access were not changed
  and she was not messaged.
- Apple Photos write-back now carries approved title, caption, natural keywords,
  `PBE-Rating-N`, optional `PBE-Color-X`, `PBE-Approved`, and each
  `PBE-Fixture-ID:<id>`. Commit requires picked plus metadata-approved plus a
  same-editorial-version verified R2 receipt; Photos is re-read before its own
  receipt is verified. A live read-only JXA rehearsal successfully resolved the
  July La Concha asset `D5H_3429.jpg` by its Photos local identifier.
- PBE-117 parity rehearsal used one live photo and one live video in a two-item
  fixture pool. The scoped endpoint returned exactly those two media types while
  the shared page, shortcuts, preview, decision writer, and upload bridge stayed
  unchanged. Full regression: 91 Node tests and 66 Python tests passed.
- Owner routes selected Apple Photos into a persistent local hierarchy
  of `RE / Fixture / Sub-fixture` (for example `RE / La Concha / Apartment 1`).
  The explicit sub-fixture selector offers Apartment 1, Apartment 2, Street,
  Main lobby, Pool, Tennis court, and `New…`; the last choice reveals a custom
  name field. The preview grid sits directly below the intake actions/status;
  the full Apple Photos album chooser is bounded to its own scroll region so it
  cannot push previews down the page. Preview and assignment actions remain
  monitored for up to 15 minutes, and a still-queued action is reported as
  waiting rather than as a false failure. `Assign selected photos` stays
  disabled until a preview exists and at least one preview is selected; it no
  longer falls through to a whole-album assignment. The preflight now consumes
  the PhotoKit bridge's actual `items` rows, so candidate thumbnails populate
  the grid; its status reports both the inspected album count and the number of
  one-second burst frames conservatively filtered. Free-text fixture names also
  create new folders. Assignment remains local-only until the separate Real
  Estate import/publish workflow is run.
- ACS now manages mutable Real Estate password credentials in D1. Owner/Admin
  can create, replace, or revoke a person's gallery-scoped login without
  storing or returning the plaintext password or password hash. A La Concha
  gallery grant covers all of its sub-fixtures; it does not require a separate
  password for each apartment or amenity.
- ACS now renders the same universal fixture hierarchy used by Owner. Expo and
  Travel are public to visitors and signed-in users. RE is a private root with
  no client group or grant; owner/admin access is implicit. Corine is the sole
  active member of `RE / La Concha`, and that access inherits through Apartment
  1, Apartment 2, Common, Main lobby, Pool, Street, and Tennis court. Production
  rehearsal identities are disabled and stripped of roles, groups, and gallery
  grants; the old Agnes Common grant is revoked.
- The Apple Photos album `RE 2026 La Concha 3 Shared Areas` contains the 31 new
  July 15 frames for private routing into Street, Main lobby, Pool, and Tennis
  court. Corine has not been messaged.
- Background connector endpoints use a per-Mac bearer credential stored only in
  the Worker secret `OWNER_CONNECTOR_TOKENS_JSON`; David and Max must receive
  different revocable tokens.
- `scripts/new_owner_connector.py` polls cloud actions without serving HTTP.
  It refreshes the Apple Photos index, returns 24-item Sidecar preview windows,
  applies stars/pick/reject/title/keywords/metadata approvals to local
  `Owner.sqlite`, and supports a deliberate guarded Upload Bridge item followed
  immediately by catalog registration.
- Owner/Admin can download the credential-free Mac connector ZIP through
  `/owner/connector/download/mac`; the package contains the stable
  `com.photosbyelie.photos-bridge` app identity and prompts for the separate
  per-Mac token at install time.
- Max's private Owner snapshot was copied over the Tailscale mesh and restored
  on David after checksum/integrity verification: `57,497` Sidecar assets and
  `57,497` decision rows. David's previous empty DB is backed up at
  `assets/owner-actions/Owner.sqlite-before-max-sync-20260710T104147Z`.
- David still needs to grant Full Photos access to the bridge app in macOS
  System Settings before cloud review windows can contain previews.
- The v132.0 production rehearsal completed a harmless cloud connector check on
  David and a 24-item culling window on Max with 24 previews and zero preview
  errors. Both per-Mac LaunchAgents are installed and online; the authenticated
  connector ZIP download was also exercised from the public Owner page.
- Current uploaded-catalog dry-run after restoring Max's Owner snapshot reports
  `3314` candidates: `2719` already cataloged and `595` that would register.
  Do not bulk-register those rows without review. The cloud Upload action is
  deliberately scoped to only asset IDs uploaded during that action.
- Current public commercial catalog: `2,713` media rows after retiring the `5,100`-row AI collection from storefront publication.
- Current gallery counts: France `379`, Italy `70`, Mexico `31`, Portugal `214`, Slovakia `2`, Spain `1,872`, USA `145`.
- AI/Leonardo source files and Owner records remain intact, while public generation, discovery, stale baskets, and Worker checkout exclude the `ai` collection and AI-origin rows.
- Camera downloads use the approved `$8 / $16 / $28 / $65` ladder for JPG 1 MP, JPG 3 MP, JPG 6 MP, and full resolution. Video duration tiers use `$12 / $20 / $28 / $35 / $50`. The matching checkout catalog is deployed in Worker version `65cc6417-b87e-48df-878d-a33bed7ea80a`.
- Queue health after cleanup:
  - Upload Bridge uploadable count: `0`.
  - Upload Bridge active blocked approved rows: `0`.
  - Upload Bridge missing key count: `0`.
  - Upload Bridge blocked export failures: `0`.
  - Picked AI metadata candidate count: `0`.
  - Uploaded-catalog registration dry-run: `2,719` candidates, `0` would register, all `already_in_catalog`.
  - Public catalog SQLite integrity: `ok`.
- Intake prep checkpoint:
  - `python3 scripts/local_server.py 8001 --bind 127.0.0.1` is the correct local helper surface for Apple Photos intake; the plain LAN/static server on port `8000` can show Owner but cannot run the Apple Photos helper endpoints.
  - The helper-backed cloud Owner page is available at `http://localhost:8001/owner.html`.
  - The installed permission-bearing app bundle exists at `~/Applications/PhotosByElie Photos Bridge.app`, version `126.2`, bundle id `com.photosbyelie.photos-bridge`.
  - The current local Sidecar Apple Photos index has `57,497` available assets: `56,000` photos and `1,497` videos, ranging from `1947-05-09T20:09:49Z` to `2026-07-07T18:06:01Z`.
  - Owner Apple Photos helper now launches `~/Applications/PhotosByElie Photos Bridge.app` through LaunchServices and reads a `--result-destination` JSON file; this fixes the previous false Photos-permission failure caused by raw `swift scripts/apple_photos_bridge.swift` using the wrong TCC identity.
  - Apple Photos album scan is working through the Owner helper: `187` albums returned (`165` regular, `22` smart).
  - The Owner Imports page proved Apple Photos album preflight with `2018 Paris` selected and dry-run complete: `318` assets checked, `263` import candidates, `55` burst-filtered, `0` blocked/unsupported. This direct Expo materialization path is now secondary; do not click `Import to Expo` for the North Star intake pass unless Elie explicitly chooses the legacy/direct path.
  - The active intake direction is Sidecar sandbox culling first, newest-to-oldest from the indexed Apple Photos library. No album selector is needed for the first pass.
  - Sidecar is running on this Mac in tmux session `photosbyelie-sidecar` at `http://localhost:8011/sidecar.html`; the Built-in Browser is parked on the Culling tab with `96` visible previews, `57,497` indexed assets, and the first batch sorted from `2026-07-07` backward.
  - Sidecar v126.5 fixes RAW-origin preview color by preferring PhotoKit current rendered JPEG data before falling back to older image render/resource paths; verified on `20221216 172145 01113.jpg`.
  - Sidecar v126.6 derives a JPEG poster from the same local video resource used for Quick Look whenever PhotoKit has no usable poster frame. The helper now reads a bridge result JSON file, preserving real preview errors rather than falsely reporting a missing cache file.
- Review backlog created by this cleanup:
  - `20` unknown-gallery/generic-title rows are resolved: `19` Benalmadena Aquarium videos are approved/picked, and `1` unsupported WhatsApp still is tombstoned.
  - `24` persistent Photos export failures are repaired from verified external picGen PNG originals, uploaded to R2 in run `ub-20260708T061127Z-325f39ae`, approved/picked, re-queued, unblocked, and registered in the public catalog.
  - `63` unpicked/proposed rows are normalized back to `unreviewed`; their proposed title/keyword context remains available in Owner SQLite.
- Latest closeout commits before this docs handoff:
  - `3c58fe88 photosbyelie: harden sidecar upload workflow`
  - `9154ef16 photosbyelie: refresh public catalog and owner surfaces`
  - `cc3bb953 photosbyelie: record working tree cleanup`
- First action on Max/current working tree:

```bash
cd /Users/ecohen/Dev/PhotosByElie
git status --short --branch
python3 scripts/sidecar_maintenance.py picked-ai-plan
python3 scripts/sidecar_state_db.py --upload-bridge-plan
python3 scripts/sidecar_maintenance.py register-uploaded-catalog --dry-run
```

- For another machine, the public catalog/docs bundle is on `main`; sync ignored/private `Owner.sqlite` through the private Owner-state path only if that machine needs the local Sidecar cleanup state.
- North Star is official at `docs/architecture/north-star.md`: the project compass is to make money from Photos By Elie through tested offers, secure paid/private access, market research, and real public/RE/family/event workflows. The near-term priority is the `57K+` Apple Photos library intake-to-sellable-catalog path; Real Estate, family sharing, and private event sales are valuable but secondary unless a real opportunity appears. `AGENTS.md` now tells future Codex sessions to warn when work drifts from that compass.
- Owner title/keyword save smoke passed on localhost helper port `8001`: row `001-0116ccd189` temporarily changed from `Benalmadena Aquarium` / `Spain` to `Benalmadena Aquarium Smoke Check` / `Spain, Aquarium`, SQLite and `worker/photos-catalog.generated.mjs` both reflected the edit, and the row was restored. The catalog DB and Worker catalog were restored byte-for-byte from the pre-smoke backup after verification.
- Real Estate output creation is fully cloud-side in `v140.22`: the client queues a saved selection and polls only. A Cloudflare Workflow creates a private, expiring render token, launches Browser Rendering against the production Real Estate page, renders the PDF and slideshow in cloud Chrome, stores the PDF directly in private R2, converts cloud-recorded WebM to MP4 through Media Transformations, and updates the durable R2 job/deliverable records. Internal render routes require the hashed job token and never expose it in client job responses. The renderer now posts authenticated, durable phase/percentage updates so the client shows a determinate bar with elapsed time and ETA; output controls, phases, shelf states, and download labels are localized in English, French, and Spanish. Production slideshow music reads a separate R2 manifest of forty verified 60-second MP3 clips; longer videos repeat the selected clip, and the original source tracks remain untouched. Live Corine proof on 2026-07-18 used the eight-photo `La-Concha-1-Apt-8AB1-260718-1` selection: the Spanish client displayed a live `28%` PDF-loading phase with elapsed time and ETA, then reached `100%` and the localized ready message; the earlier end-to-end proof confirmed the cloud video and both finished-product download controls. Deployed Worker version: `feb2de0e-5855-4be5-80c2-c862bf8d7955`.
- In `v140.23`, a successful gallery-scoped Real Estate password session also updates the shared site header: the visitor Sign Up / Sign In pills are replaced by the face icon for the life of that scoped session. This is a presentation/session bridge only; ACS gallery grants remain the authorization source of truth, the scoped session does not gain a general account profile, and signing out from either the face menu or the Real Estate action bar clears the Real Estate session. Live Corine verification confirmed the face icon visible and both visitor pills hidden on the unlocked gallery. Deployed Worker version: `05262449-6c4a-4e11-8dd2-d7e4b0840b6d`.
- In `v140.24`, the account panel keeps only the contextual Sign out control beside the signed-in identity. Signing out clears account-synced basket, likes, order references, and profile cache from the browser before visitor mode resumes, and Basket/Liked redraw on the same page so departed-account data is not left visible. GitHub Pages deployment `29661350974` completed successfully; live visitor cleanup verified `0 assets, $0`, `Your basket is empty`, and `No liked photos yet`. Deployed Worker version: `630e7c61-fc6d-4645-8f91-da15edb60f9c`.
- In `v140.25`, the Real Estate finished-products shelf no longer shows the manual cloud-sync status banner or Sync button. Its saved-product fetch remains automatic on unlock, reload, and relevant workflow transitions. GitHub Pages deployment `29661904950` completed successfully, the live JavaScript contains neither removed UI marker, and the v140.25 Corine page rendered without the banner. Deployed Worker version: `3437e035-ed35-4c69-bb25-1005fbe3f6f6`.
- In `v141.0`, the Real Estate output step is renamed Create and download and replaces ambiguous selects/number inputs with radio choices for A4/Letter, 3/4/5 seconds, PDF landscape/portrait, and video landscape/portrait. Queue PDF/Video becomes Download PDF/Video when a settings-matched cloud product is ready. Wizard status has stronger contrast; hero metrics explicitly distinguish source photos, source videos, shoots, and cloud-synced saved products. Language and theme preferences now follow the active identity; Google profiles persist both fields in cloud profile storage, while legacy password clients keep identity-specific device preferences. Full test suite: 90 Node tests plus 55 Python tests passed. GitHub Pages deployment `29662932443` completed successfully; live browser verification showed the four radio groups, current 99 source photos / 0 source videos / 3 shoots / 2 saved products, and direct Download PDF / Download video actions for a ready saved product. Deployed Worker version: `61b3fb7c-3ba9-411e-9001-337ea54ad473`.
- In `v141.11`, authenticated public Owner sessions gain gallery multi-select, `H`/`X` Waste Basket moderation, and grouped `U` undo through the cloud Owner-action ledger routed exclusively to the Max connector. The connector records durable lifecycle state immediately and leaves static catalog publication to the normal pipeline, avoiding a full catalog rebuild on every moderation click. Public detail metadata drops the redundant Origin, Metadata title, and Info controls; the full-screen preview keeps the title and navigation while hiding internal media IDs, source labels, and storage URLs. Live public proof moved `20180304-1745-00117-1ceb19d795` to Waste Basket and restored it to active with `U`; no proof item remains hidden. Full regression suite: 94 JavaScript tests plus 88 Python tests passed. GitHub Pages deployment `29703861530` completed successfully. Deployed Worker version: `a01e8761-27f5-49dc-b457-7ce71ef06184`.
- In `v145.4`, Waste Basket restore preserves the Worker action ledger as the authorization, audit, and durability gate while immediately waking Max's localhost connector with the opaque action ID only. The connector refetches and claims that exact Max-targeted action with its own credential, executes it once under a shared lock, completes it in the Worker, and falls back silently to the existing five-second poll when localhost is unavailable. Restore no longer performs a browser title preflight or accepts browser title data: Owner.sqlite recovers the private lifecycle title and commits lifecycle, accepted title, and applied queue state atomically, cancelling without mutation when the private title is missing. Action timings record queued, locally awakened, claimed, executed, and completed stages. Full regression suite: 117 JavaScript tests plus 109 Python tests passed; publish validation still reports only the pre-existing seven hidden/discarded IDs duplicated across the public catalog and expo manifest.
- In `v145.7`, the phone Real Estate journey hides internal gallery totals, forces the Balanced photo-card layout, and fits its compact five-step rail entirely inside the viewport. The Output step now exposes the originals ZIP action alongside PDF and video actions. Live Corine rehearsal confirmed the isolated La Concha shelf at 99 source photos / 3 shoots / 2 saved products and exercised the ready PDF/video download controls; an actual originals ZIP remains password-gated and Corine has not been messaged.
- In `v145.8`, selected image previews in Real Estate Titles and Order request eager decoding so iPhone Safari does not strand images first rendered inside a previously hidden phase. A phone-only Next button now follows the active list, while the existing top Next remains available. The 2026-07-22 Corine shelf currently has 3 saved products; Corine still has not been messaged.
- In `v145.9`, ready PDF actions on touch devices fetch the authenticated cloud file and trigger an octet-stream `.pdf` download, bypassing Safari's inline PDF preview and its extra save taps. Ready video and desktop download paths remain unchanged; the same PDF behavior applies from Output and the finished-products shelf.
- In `v145.10`, Real Estate mode no longer injects the public Likes and Basket header actions. Account and Settings remain available, and the public photo/shop pages retain both actions.
- In `v142.0`, public Owner title/keyword edits and keyword-blacklist management
  write through the Max connector, while the spacebar preview repeats Keywords,
  Captured, Camera, Lens, Exposure, Focal length, Original file, Original size,
  and Location without showing media ids or R2/source paths. Sidecar registration
  now refuses hidden/discarded rows, applies identity-level tombstones, backfills
  legacy source origins, and supports a SQLite-to-browser `--bootstrap-only`
  refresh. The validated public catalog contains 3,554 camera-made items; the
  exact media-sidecar and Expo manifest no longer contain the removed rows.
- In `v142.1`, panorama full-height mode keeps a viewport-fixed `Exit full
  height` control visible on desktop and mobile. Panorama motion begins slowly
  from the left after 1.1 seconds, stops permanently for that view on pointer,
  wheel, or keyboard takeover, and is disabled by reduced-motion preferences.
  The spacebar preview also exposes a fixed close button. Headless Chrome
  interaction checks passed at desktop and 390 x 844 mobile viewports; the full
  regression suite passed with 95 JavaScript and 91 Python tests.
- In `v142.2`, idle panorama motion starts from the exact horizontal midpoint,
  moves first toward the left edge, and then reverses continuously at both
  edges. Pointer drags track release velocity and coast with friction until a
  boundary or a fresh pointer/wheel/keyboard gesture stops the motion. Horizontal
  touch dragging preserves vertical page scrolling, and reduced-motion users
  receive no autoplay or inertia. Browser interaction checks confirmed center-
  first travel, `110 px` of post-release coasting in the sampled gesture,
  immediate wheel cancellation, and a visible exit control at `390 x 844`.
- In `v143.5`, authenticated Owner country galleries implement native-style
  pointer selection: a plain click starts a selection, Command/Ctrl-click
  toggles individual photos, and Shift-click extends a contiguous range from
  the anchor. Selection visuals update in place instead of rebuilding the
  gallery. Public metadata moderation now forwards title, keyword, and mode
  fields through the cloud Owner-action ledger to Max; this fixes the prior
  `title must be a non-empty string` rejection. Waste Basket and metadata
  actions no longer lock the whole page while Max confirms them, and a failed
  single-photo move is surfaced to the caller instead of being overwritten by
  a false success message. Full regression suite: 113 JavaScript tests plus 91
  Python tests passed.
- In `v143.7`, Build a Fixture spans the Owner workspace so its step rail,
  fixture controls, and responsive fields cannot overlap the neighboring
  masonry cards. Owner also exposes a connector-backed Waste Basket manager
  with multi-select restore, permanent discard, and confirmed empty-basket
  operations through the supported lifecycle writer. A signed, paginated R2
  cleanup removed `69,960` unreferenced catalog-prefix objects totaling
  `362,526,753,985` bytes; the independent post-cleanup dry-run preserved
  `10,764` catalog/active/hidden objects and found zero further candidates.
  Real Estate, deliveries, music, shared, and root prefixes were out of scope.
  The visible catalog has `3,531` items; `3,528` have private masters in R2,
  while `img-5988-fe9bda0bdb`, `img-6157-40f428f4db`, and
  `img-6174-8674aea1e3` need source-master repair when their source volume is
  available. Missing cached JPG sizes are not blockers because the Worker
  derives them from a present master on demand.
- Paid/private access item #4 has central ticket `PBE-20260708-6FBE` and a stronger Worker regression pass in the current working tree: `publicOrder` hides delivery ZIP/storage keys by default, deployed checkout/order/session payloads expose only Worker download-token URLs and buyer-facing file details, and Real Estate deliverable/job/list payloads no longer expose output R2 keys, source-video private keys, private master fields, or cloud-source keys while internal R2 records retain the keys needed for authorized asset serving. `worker/local-server.mjs` opts into `exposeDeliveryStorageKeys: true` only for localhost ZIP inspection. Verified with `node --check worker/checkout-worker.mjs`, `node --check worker/local-server.mjs`, `node --check worker/real-estate-deliverables.mjs`, `node --test worker/checkout-worker.test.mjs`, full `npm test`, and `git diff --check`.
- Next Apple Photos intake action: use `http://localhost:8011/sidecar.html` for Sidecar sandbox culling from today backward. Pick/reject/hide in reasonable visible-preview batches first; only reviewed/picked survivors should later flow toward Upload Bridge/catalog publishing. Treat Owner `Import to Expo` as a secondary direct path, not the default intake route.
- Deferred hygiene action: add a supported retry/reset command for Upload Bridge export blocks so future block clearing uses a named maintenance path instead of ad hoc SQL.

- Sidecar PhotoKit automation must launch through the permission-bearing app bundle, `~/Applications/PhotosByElie Photos Bridge.app`, via LaunchServices. Do not call `swift scripts/apple_photos_bridge.swift` or the bare bundle executable for scheduled Sidecar automation.
- Sidecar quick view now includes a desktop side metadata panel for camera, location, resource format, and pixel size. Format/size and some location labels come from the current Apple Photos index; camera currently falls back to `not indexed` because the PhotoKit bridge does not yet persist EXIF camera make/model.
- Sidecar culling selection now preserves direction of travel across disappearing cards. If the active card is picked/rejected/hidden/unpicked and stops matching the current filters, the next highlight lands on the adjacent visible neighbor rather than restoring a stale index after reload.
- Approved Upload Bridge rows with generic titles and no country/gallery signal should be blocked from queueing until metadata is repaired.
- Owner quick previews now fall back to the same public media URL a regular visitor receives when original source files cannot be resolved.
- Owner title/keyword edits for SQLite-backed catalog rows should write through the localhost helper to `assets/catalog/photosbyelie.sqlite` and regenerate the Worker catalog; the old TSV writer path is not the authority.
- Public deploy verification after the catalog publish is complete: public `v125.0` loads, AI `5,100`, Spain `1,872`, Italy `70`, repaired portrait previews, and Benalmadena Aquarium video previews are verified.

## Historical Handoff: 2026-06-21 Direct Google Auth / Max Testing

- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Branch: `main`
- Public site: `https://photos-by-elie.com/`
- Current visible build: `v113.0`
- Auth Worker/custom domain: `https://auth.photos-by-elie.com`
- Worker version after direct OAuth route deploy: `87e9419f-f47c-472b-80c8-fa7e8dbae07c`. Direct OAuth secrets are enabled, so `/auth/google/login` now redirects to Google with `prompt=select_account` and `redirect_uri=https://auth.photos-by-elie.com/auth/google/callback`.
- Latest relevant commits:
  - current `v113.0` implementation: public Account and Real Estate Google buttons target the Worker-owned direct OAuth route at `/auth/google/login`; successful callback sets a signed `pbe_google_session` cookie that feeds the existing role registry
  - `v112.10` experiment: Account sign-out targeted the Cloudflare Access team-domain logout URL, but iPhone testing still ended in Cloudflare's no-cookie page or reused the previous Google account
  - `v112.9` rollback: remove the direct Google AccountChooser detour after Google returned a malformed-request page
  - `cf7fc214 photosbyelie: add account sign out`
  - `08d38809 photosbyelie: fix real estate google login host`
  - `c757d26a photosbyelie: activate google access login`
  - `88e07204 photosbyelie: add public google account entrypoint`
- Max first action:

```bash
cd /Users/ecohen/Dev/PhotosByElie
git pull --ff-only origin main
npm install
npm test
npm run validate
```

- Test the public homepage account icon near the Settings cog, Google sign-in, signed-in account sheet, and `Sign out`.
- Direct `https://auth.photos-by-elie.com/` visits should redirect to `https://photos-by-elie.com/?account=1`, not show raw Worker JSON.
- Account sign-in/up should go through direct Google OAuth on `https://auth.photos-by-elie.com/auth/google/login`, not through Google AccountChooser and not through the protected `/auth/login` Access app. The Worker includes a safe fallback: if direct OAuth secrets are not configured, `/auth/google/login` redirects to the legacy `/auth/login` path.
- Current account-switching blocker: `PBE-20260620-342B`. Cloudflare Access prompt/logout experiments did not reliably let iPhone Safari choose another Google account. The durable path is direct Google OAuth with `prompt=select_account`, controlled by the Worker.
- Direct OAuth activation state: the Google OAuth client now authorizes `https://auth.photos-by-elie.com/auth/google/callback`, and the Worker has `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and `GOOGLE_OAUTH_SESSION_SECRET` set as secrets. Live `/auth/google/login` has been verified to redirect to Google with the Worker callback.
- Test Real Estate Google login from `real-estate.html?client=corine` or the current client key. It should route through `/auth/google/login`, return to the RE page with `access=1`, then `/real-estate/access-login` should mint the gallery-scoped session.
- Test `owner.html` after signing in with an Owner/Admin Google account. The public dashboard should open read-only with localhost-only import, upload, cleanup, publishing, and role-management actions disabled; full mutation actions still require the localhost Owner helper.
- Expected role behavior: ungranted verified Google users remain normal users; granted RE client emails are limited to their assigned gallery keys; Owner work requires an Owner grant and still treats local David admin as the role-management authority.
- If stale Cloudflare Access state causes confusing results, verify whether direct OAuth secrets are actually enabled. Once direct OAuth is active, Account -> Sign out only needs to clear the Worker Google session cookie and return to the Account sheet.
- Google OAuth client credentials and Worker secrets stay outside git. Do not copy secrets into repo docs or handoff files.

## Handoff Direction

- Gmail self-email is retired for Max/David handoff instructions and reports. Do not search, send, or treat Gmail as authoritative for this workflow unless the user explicitly asks about a specific message.
- Primary Max/David coordination is direct Tailscale/mesh. Use the central Tickets API for routine ticket updates, SSH/Codex Remote SSH for remote execution when available, and live mesh/remote channels for Codex-to-Codex delegation.
- `MAX2DAVID.md`, `DAVID2MAX.md`, and `MAX_DAVID_CHAT.md` are legacy/manual fallback records. Do not add new routine prompts there unless direct Tailscale/mesh coordination is unavailable or the user explicitly asks for file-based handoff.
- If a file-based fallback is active, keep the old directionality: Max-to-David prompts in `MAX2DAVID.md`, David-to-Max reports in `DAVID2MAX.md`, and commit/push durable handoff-file updates when the other machine needs to receive them.
- When direct mesh is the active live channel, acknowledge and report there instead of writing a handoff file.

## Historical Handoff: 2026-05-22 Revenue Track

- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Public site: `https://ec92009.github.io/PhotosByElie/`
- Local owner preview: `python3 scripts/local_server.py 8000`
- Current visible build: `v94.5`
- Social/Pinterest/Threads destinations should point to first-party campaign mini-collections or a fresh homepage latest-social shelf whenever practical, so buyers can browse related photos and escape embedded browsers before checkout/download. Broad gallery URLs remain acceptable fallbacks only when a campaign/homepage change is unnecessary or unsafe.
- Etsy approved the `photosbyelie-listing-publisher` API integration by email on 2026-06-01 at 20:54 UTC. OAuth and API smoke checks are proven locally with credentials/tokens stored outside git. Etsy approved the shop rename to `PhotosByElieShop` on 2026-06-02; the API shop record reports shop `42422777`, public URL `https://www.etsy.com/shop/PhotosByElieShop`, and `0` active listings. The next Etsy step is draft/dry-run listing payload generation from public catalog data and watermarked public previews only.
- Recent baseline commits include: `8193a5ee photosbyelie: record social browser checks`, `cc886957 photosbyelie: prepare 2026-05-27 social packages`, `2bae81d4 photosbyelie: simplify pinned collections shelf`, and the new `v88.2` Real Estate saved-selection shelf pass.
- Current business direction: focus on turning the site into a selling machine. Payments, delivery trust, buyer offer clarity, pricing, curation, analytics, SEO, landing pages, and launch outreach now lead the backlog.
- Public Expo catalog: `6,672` publishable media rows after the Pisa phone-export restore: AI/Leonardo `4,921`, France `315`, Italy `33`, Mexico `2`, Portugal `216`, Slovakia `2`, Spain `1,024`, USA `159`. Compared with the earlier `6,016`-row checkpoint at `736fe76b`, the catalog is `+656` rows overall; Italy was restored from `0` to `25` by adding Florence/Firenze, Pisa, San Gimignano, and Tuscany country hints, then the ten older `2024 Pisa/Pisa, 12 May 2025` phone-export rows were restored under their original IDs. Two recently blocked Italy rows are excluded from the active count.
- Public catalog data is SQLite-backed: `assets/catalog/photosbyelie.sqlite` is the active plain payload, and `photos-data.js` is the bootstrap for the existing `window.photosByElieData` browser contract. Brotli `.sqlite.br` is legacy-only and not part of normal operations.
- Waste Basket is the Owner-facing model for unwanted photos. Basketed photos are live-blacklisted and can be put back; emptying the basket deletes public previews, private masters, and private render triplets, then leaves durable tombstones so those masters do not return.
- Waste Basket purge was intentionally paused during catalog migration. Resume only when ready to monitor the `Cloud media left` progress.
- Tombstoned/Waste Basket photos are not buyer inventory. Basket checkout now prunes stale browser selections for tombstoned photos and validates selected private master/render availability before Stripe.
- Owner R2 coverage excludes Waste Basket tombstones from active repair targets and can list missing private masters/triplets for active photos, preferring Saturn/source-file repair when the source path resolves. The Owner dashboard is grouped into Review, Expo, Real Estate, Catalog, Cloud, and Commerce tabs, with cloud sweep progress details shown inline by phase.
- Local Owner actions are unlocked by `scripts/local_server.py` on localhost without a password. Add `--bind 0.0.0.0 --allow-lan-owner` only when a private-LAN owner review session is intentional.
- Public previews are watermarked and public in R2 under flat `expo/<photo-id>_900.jpg` and `expo/<photo-id>_1800.jpg` keys.
- Public browsing now loads previews through the custom Worker media route: `https://download.photos-by-elie.com/media`.
- The checkout Worker is no longer in the public preview hot path. Keep it focused on checkout, order state, Stripe/webhook handling, pre-Stripe private-file validation, and delivery.
- Private developed sources are in `photosbyelie-private/masters/<photo-id>/<original-file>`.
- Private buyer JPG deliverables are in `photosbyelie-private/renders/<photo-id>/<original-file>-jpg-{6mp,3mp,1mp}.jpg`.
- Public buyer delivery uses per-file private R2 download tokens. Local mock delivery can still generate flat ZIPs for test convenience.
- Uploaded masters, private render triplets, and public previews are treated as immutable after upload. Owner title/keyword/country edits update manifests/catalog SQLite/bootstrap files only; a future Lightroom-style XMP sidecar save should be an explicit Owner maintenance action.
- Physical print/frame products are buyer-hidden by default. Owner can deliberately enable them on localhost for review, but digital checkout should be proven first.
- Owner has local price editing. Published digital checkout defaults now use the restored original ladder: camera JPG 1 MP `$8`, JPG 3 MP `$16`, JPG 6 MP `$28`, full resolution `$65`; AI JPG 1 MP `$4`, JPG 3 MP `$8`, JPG 6 MP `$14`, full resolution `$25`. The buyer Pay section and Worker still include Stripe minimum-charge protection, though current public prices are above that floor.
- Camera vs AI is now a first-class catalog origin (`sourceOrigin`) used by public gallery filters, detail metadata, Owner active-catalog counts, and Worker checkout pricing. Do not rely only on the `ai` collection slug for AI-origin behavior.
- Public pages use English/French/Spanish translation. Owner-only localhost pages remain English-only by design.
- Waste Basket review now uses the shared gallery-card treatment and the same density/fit masonry behavior as public galleries.
- Public collection pages use the shared `gallery.html?gallery=<slug>` route.
- `v80.8` publishes the latest Owner title/keyword approvals into the public SQLite catalog and Worker catalog, adds model provenance to the Owner title/keyword review cards, defaults Owner Review to the title/keyword queue, and clears stale proposed rows that are already blocked or missing from the public catalog.
- `v81.4` publishes 239 approved title/keyword rows from batch `2026-05-19-230413-165Z` into the public SQLite catalog, compressed catalog, homepage data, Worker catalog, and tracked approval audit export.
- `v81.10` publishes 53 approved title/keyword rows from batch `2026-05-20-093025-705Z` into the public SQLite catalog, compressed catalog, homepage data, Worker catalog, and tracked approval audit export.
- `v82.0` publishes the latest Owner discard/tombstone state into the public SQLite catalog, Expo manifest, homepage data, Worker catalog, discarded media manifests, and the Corine Real Estate context timestamp.
- `v82.1` keeps the documented Nerja Best Mix glass alpha/frosting recipe, harmonizes shared filter/control heights, and stabilizes the homepage photo-stack entrance animation.
- `v82.2` changes the first-open gallery density fallback to 3 columns while preserving any saved user density choice.
- `v82.5` publishes the latest Owner discard/tombstone state into the public SQLite catalog, Expo manifest, homepage data, Worker catalog, and durable discarded-photo tombstones.
- `v82.7` hardens buyer order recovery and delivery links: `order.html` can look up an order by order ID and checkout email, Worker download tokens carry expiry/limit metadata, successful downloads are recorded on the order, and Stripe Checkout receives the buyer email for receipts.
- `v83.0` publishes Owner-approved title/keyword metadata into the buyer-facing SQLite catalog and Worker catalog, and refreshes the keyword blacklist compatibility export.
- `v83.1` saves rejected title/keyword review comments with the rejected proposal title and keywords attached for the next AI rework rung.
- `v83.2` lowers JPG 1 MP and 3 MP checkout tiers to $0.10 and $0.30, formats buyer pricing in cents, adds the Stripe $0.50 minimum-charge top-up, and adds a Dock launcher for localhost Owner.
- `v94.5` restores the original public digital-download ladder after proof-flow testing: camera `$8 / $16 / $28 / $65` and AI `$4 / $8 / $14 / $25` for JPG 1 MP, JPG 3 MP, JPG 6 MP, and full resolution.
- `v83.3` publishes the camera-tripod mark as the public favicon/topbar logo, adds buyer trust notes to basket/order, and adds `support.html` for payment, delivery recovery, license, and support expectations.
- `v83.4` promotes the first Photos By Elie Facebook Page post alongside Pinterest features on the homepage.
- `v83.6` adds localhost-only POD supplier readiness, quality-tier routing, supplier option, and catalog schema preview panels in Owner Commerce while keeping public print checkout gated off.
- `v83.7` lets the Owner import flow choose a local source folder instead of depending only on fixed source anchors.
- `v83.8` publishes the latest Owner discard/tombstone state into the public SQLite catalog, Expo manifest, homepage data, and durable discarded-photo tombstones, reducing active public rows to `6,016`.
- `v83.9` keeps selected-folder imports focused on import phases, avoids banned-photo cleanup noise in that path, caches import thumbnails, and gives the per-photo import matrix visible working states.
- `v83.10` makes the active/next import matrix state obvious with an inferred active worker row, animated next-queued row, and live dots inside unchecked cells.
- `v83.11` adds the Owner import source pulldown, remembered source storage/discovery, explicit maintenance buttons, and truthful task-scoped progress stacks.
- `v83.12` makes GUI/Dock-launched imports see Homebrew tools such as `exiftool`, `ffmpeg`, and `ffprobe` so selected-folder imports do not fail on a stripped Safari helper PATH.
- `v83.13` opens the native folder chooser as soon as Owner selects `New...` in the import source pulldown and simplifies per-photo import progress to one thumbnail/name row per photo.
- `v83.14` reconciles Owner import waiting counts against the visible processed/active/photo rows so failed rows do not inflate the queue.
- `v83.15` surfaces the already-current import count so Owner can see photos skipped before the current run, removes the noisy per-photo queue summary strip above import thumbnails, and runs import render/upload work with a half-CPU parallel worker pool by default.
- `v83.16` replaces import progress prose with a four-tile stats panel: photos found, processed before, processed this run, and time left.
- `v83.17` makes the stats panel restart-honest by counting only successful imports under Processed this run and surfacing failed attempts in the tile note.
- `v83.18` adds horizontal inset to the Owner tab strip so the first tab no longer crowds the left frame.
- `v83.19` renames Owner Imports to Expo, moves Expo before Real Estate, keeps broad Expo imports gallery-only, and puts the Real Estate source pulldown plus `RE import` button inside the Real Estate tab.
- `v83.20` defaults the Real Estate source pulldown to the selected client's current source so `New...` remains an explicit choice.
- `v83.21` makes Processed this run count completed photo attempts, including failed attempts, so the tile remains stable while failures stay visible in the note.
- `v83.22` makes the Processed this run note include successful completions, runs sweep Python calls through the Pillow-capable interpreter, and preflights Pillow before queuing photos.
- `v83.23` makes discarded/Waste Basket source paths participate in import and export filtering, records source paths in new tombstones, and adds a read-only audit for source-path tombstone dodgers in current manifests/R2 state.
- `v83.24` stops the Expo source pulldown from mining import-log subfolders, restores the Green + 4-star eligibility gate only for Camera imports/exports, leaves AI imports tombstone-driven, and adds an R2 audit/delete pass for ineligible Camera rows.
- Live checkout Worker version `143f9f7f-ab55-4f82-9a68-88e4ab663cdb` is deployed with the `v83.2` price/minimum-charge catalog and `DOWNLOAD` card statement descriptor suffix.
- Stripe sandbox checkout is proven end to end: success, decline, 3D Secure, webhook delivery, order recovery, per-file download, and download-all were manually verified.
- Live Stripe account `acct_1TWCksPuO9o6fOp6` is configured with the camera-tripod branding, brand color `#5B341E`, accent color `#D86A3E`, successful-payment customer receipts enabled, and refund emails off.
- Live Checkout card statement descriptor suffix is `DOWNLOAD`, so future charges should display like `PHOTOSELIE* DOWNLOAD` with the current Stripe descriptor prefix.
- Live Stripe webhook destination `we_1TZmoVPuO9o6fOp6JkBENiyV` is named `PhotosByElie Worker checkout` and posts `checkout.session.completed` to `https://photosbyelie-checkout-mock.ec92009.workers.dev/stripe-webhook` on Stripe API version `2026-04-22.dahlia`.
- Live Cloudflare secrets `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are installed outside git.
- Live checkout proof succeeded with order `PBE-20260522-BA062E956C`: `$8.00` paid, `$7.47` incoming after Stripe fees, Worker order status `ready`, and one private JPEG download verified at `401,035` bytes.
- Price/offer strategy draft: `docs/commerce/PRICE_OFFER_STRATEGY.md`. It recommends keeping launch digital-only and, after owner approval, replacing the proof-flow low tiers with a real camera ladder of `$3 / $8 / $28 / $65` and a lower AI ladder of `$2 / $5 / $14 / $25`.
- Local POD preview draft: first print sizes are 12x16, 16x20, and 18x24; Prodigi is the primary/value route, Printful is the standard fallback route, theprintspace is the premium candidate, and Gelato stays as API-proof/global-routing candidate. `pod_settings.storefrontEnabled` remains false.
- First-pass public crawl files exist: `robots.txt` and `sitemap.xml`.
- Latest checkpoint is `v90.13`; default Real Estate photo titles no longer include the property name, and the viewer strips the old `{property} - ` prefix at runtime so video/PDF output does not repeat the property name. The Real Estate fixed header is also more opaque so it matches the page panels instead of looking like a separate translucent strip, and the desktop bottom action bar hides output downloads until the Output step plus hides Clear selected until a selection exists after the shoot-picking step. The Owner Real Estate table has a per-row Login button that seeds the local session from the Owner-only client password and opens directly inside that client's matching local review context. The Real Estate client page starts on a saved shelf, saves current selections through the cloud deliverables/R2 path, names products with editable YYMMDD-type sequences, removes visible selection-file buttons, and opens prior work into a separate detail flow with Back to shelf plus Property/Photos/Titles/Order/Output navigation. PDF and video preview/download actions now save the active selection before rendering starts, so closing the browser mid-preview does not lose the current work. The browser video preview shows only the slideshow plus an obvious Close preview button and Play/Pause controls; if the preview cannot close its own tab, it returns directly to the Real Estate Output step instead of the generic entry page. On phone-sized Real Estate screens, the fixed Real Estate action bar and site footer are hidden across all steps so the wizard and media cards are not covered by repeated chrome. Video previews keep centered titles anchored to the bottom of the actual watermarked photo and fade music across the final slide before playback stops. Download flows keep HTML as preview-only and expose separate PDF and video file buttons; desktop video download now uses a normal file download instead of the native Safari share sheet, while phone/tablet-style browsers keep the native share behavior. The video file is prepared proactively after selection/settings changes, MP4 where supported and WebM otherwise, with a phone-safe vertical MP4 path. Real Estate video recording now requests pending MediaRecorder data before stop, reports a finalizing state after the last slide, uses a stop-event watchdog so iPhone/Safari does not stay forever on "Recording slide N/N," and loads still frames through Worker media URLs before direct R2 URLs with 1800px/900px fallbacks. Real Estate help dismissal is section-wide, not per gallery, while old per-gallery dismissals still count; v90.7 records dismissal in localStorage, sessionStorage, and a cookie fallback, and marks the automatic first-view prompt seen as soon as it opens. Real Estate video output uses the forty normalized Pixabay country candidates instead of the old original cue pool, picks Spain/Portugal/France/USA from the Output-page selector or Auto from project inference, routes public music playback through the Worker media route, and keeps required credit metadata in the slideshow manifest. The public slideshow music audition gallery reads Pixabay candidate metadata and MP3s from the same Worker/R2 media route on GitHub Pages, localhost still uses local files, the Worker preserves byte-range audio responses, and the gallery now uses direct CORS-enabled audio playback instead of a Web Audio graph so mobile browsers do not mute cross-origin MP3s. The next Real Estate hardening pass should move final PDF/video assembly fully server-side and rehearse one complete public client lifecycle.
- Daily social-post automation `pbe-daily-social-posts` is active at 09:00 local time. It prepares three different daily themes for Facebook, Instagram, and Pinterest, then `npm run social:packages -- --date YYYY-MM-DD` finalizes first-party campaign targets, stages drag-ready local upload trees under `socials/{Platform}/YYYY-MM-DD/{theme-slug}/`, derives Threads from Instagram when useful, records published URLs or manual blockers, and publishes only when existing authentication allows it.
- The 2026-05-25 daily social package is prepared from public R2 previews only: Facebook `Albi River and Brick Cathedral` has 8 images, Instagram `Madrid Chapels and Courtyards` has 10 images, Pinterest `Northern Portugal Green Horizons` has exactly 5 images, and Threads has a 4-image Madrid variant. The Threads onboarding/test post was manually completed from Chrome; no platform URL was captured.
- The tracked QR coaster 3MF assets were refreshed after print/underside review. Treat them as current printable project files unless a newer slicer/export pass replaces them.

## First Commands On A Machine

```bash
cd /Users/ecohen/Dev/PhotosByElie
git pull --ff-only origin main
npm install
npm test
npm run validate
python3 scripts/local_server.py 8000
```

Then open:

```text
http://localhost:8000/
http://localhost:8000/owner.html
```

If the checkout path is upper-case on a machine, use:

```bash
cd /Users/ecohen/Dev/PhotosByElie
```

## Current Priority

1. **Run a full Real Estate client rehearsal.**
   - Import/publish/upload one client property set, save a selection, generate PDF/video, reopen from mobile, rename, and delete a throwaway product.

2. **Create first-party social springboards and a homepage latest-social shelf.**
   - Start with the 2026-05-27 social packages and use only public catalog data and watermarked public previews.
   - Apply the visible-site versioning SOP, validation, commit, and push before using any new URL in social posts.

3. **Teach the daily social automation to prepare the target before posting.**
   - Create or choose the first-party campaign/homepage target, stage platform upload trees, and record published URLs/manual blockers.
   - Keep Pinterest exactly five images; keep Facebook/Instagram at 5-10; add Threads 3-4 image variants only when useful.

4. **Finish import re-export de-duplication and clean duplicates.**
   - Use full source pathname plus modified date as the source anchor.
   - Same-path re-exports with a newer modified date should overwrite the previous master, previews, and JPG triplets rather than creating a duplicate photo.
   - Audit today's imports and prepare a reversible duplicate cleanup before deleting anything. The Italy audit proved selected-root subfolder imports can derive duplicate IDs for already-known source files.

5. **Add import source history management.**
   - Let Owner remove missing or stale remembered folders, optionally pin favorites, and inspect the last-used time/source path before starting a run.
   - Include a one-time review of any legacy entries saved before `v83.24`, because log-discovered folders are no longer added automatically but older remembered rows may still exist locally.
   - Keep `Owner.sqlite` authoritative; do not introduce another JSON state file.

7. **Keep Owner/generated state handoff-ready.**
   - Review local approval/proposal/discard/catalog state before each generated-data commit.
   - Commit tracked manifest changes only when they represent durable R2/catalog state.
   - Keep unrelated local edits out of feature commits.

8. **Review checkout trust and buyer support wording.**
   - `v83.3` ships conservative support/license defaults; owner should approve or adjust refund, delivery-refresh, and commercial-use language before heavier launch traffic.
   - Use `docs/commerce/PRICE_OFFER_STRATEGY.md` as the current refund/support policy draft before editing public copy.
   - Keep Stripe receipts as payment records and PhotosByElie order/support pages as delivery/recovery records.

9. **Make checkout and delivery production-durable.**
   - Choose D1 vs KV for longer-term order state.
   - Store order ID, buyer email, basket snapshot, expected/paid amount, status, delivery file keys, and download timing.
   - Current KV defaults retain checkout-session lookup keys for 90 days, keep download tokens available for 30 days, and allow 100 successful downloads per token unless Worker environment values override them.
   - Make receipt/order/download copy explicit and trustworthy.

10. **Package the buyer offer.**
   - Clarify usage rights, resolution labels, what Full resolution means, delivery expectations, refunds, and contact.
   - Decide first public offer: digital-only single assets, bundles, or collection packs.
   - Rephrase basket/order language around draft/review/availability so it builds confidence.

11. **Validate the real price and offer strategy.**
   - The camera ladder is approved at `$8 / $16 / $28 / $65`; AI-generated images are retired from the commercial storefront.
   - Keep catalog/browser/Worker prices aligned and run one controlled live proof purchase.
   - Defer bundles, collection packs, buy-all-liked, and promo-code hooks until single-photo launch behavior is proven.

12. **Curate the first sellable storefront.**
   - Review visible catalog before paid traffic or launch outreach.
   - Block photos that should not be sold or shown.
   - Pick featured collections and hero images.
   - Put strongest commercial/travel/editorial sets first.

## Active Sweep / Automation

- Daily automation: `photosbyelie-daily-cloud-media-sweep`
- It runs `zsh -lc './scripts/run_cloud_media_sweep.zsh --push'` so credentials from `~/.zshrc` are available.
- The wrapper uses `.review-logs/cloud-media-sweep.lock`; if a manual run is still active, the scheduled run exits without starting a second uploader.
- Daily automation: `Photos By Elie R2 master-chain repair`
- It runs `node scripts/repair_r2_master_chain.mjs --repair --prune` through the app automation. The pass reads live R2 masters first, restores missing catalog masters from Saturn/local sources, repairs private render triplets, prunes derivative ghosts, and refreshes the private-delivery/public-preview inventory manifests.
- Daily automation: `PBE Daily Social Posts`
- It runs as automation id `pbe-daily-social-posts` at 09:00 local time. The run should pick three distinct themes, prepare the first-party campaign/homepage springboard target before posting, collect 5-10 watermarked public media-route images for Facebook/Instagram and exactly 5 for Pinterest, stage upload-ready `socials/{Platform}/YYYY-MM-DD/{theme-slug}/` folders through `npm run social:packages`, publish only when Facebook/Instagram/Pinterest/Threads are already authenticated, and otherwise leave exact ready-to-publish captions, image lists, URLs, manifests, and manual blockers. It must not use private masters, unwatermarked private renders, buyer downloads, Owner-only metadata, or secrets.
- A manual run can be started with:

```bash
zsh -lc './scripts/run_cloud_media_sweep.zsh --push'
```

Before starting a manual sweep, inspect the lock/log so only one R2 media sweep runs at a time.

The sweep:

1. Pulls latest `main`.
2. Deletes discarded public/private R2 media while preserving tombstones.
3. Scans Saturn Camera, Apple Photos album exports, and Leonardo developed-source folders.
4. Imports/uploads only non-discarded candidates.
5. Regenerates the public SQLite catalog artifacts, the small `photos-data.js` bootstrap, `worker/photos-catalog.generated.mjs`, `assets/media-sidecar.json`, and private delivery manifests.
6. Backfills missing private JPG 1/3/6 MP render triplets.
7. Deletes discarded R2 media again.
8. Runs tests and validation.
9. Commits and pushes tracked changes.

## Saturn / Import Sources

- Camera: `/Volumes/Saturn/Pictures/LR/Camera`
- Apple Photos album exports: `/Volumes/Saturn/Pictures/LR/Apple Photo Albums`
- Leonardo/AI: `/Volumes/Saturn/Pictures/LR/_All Leonardo`
- RAW/DNG/NEF files are not public-site or cloud-storage inputs. Use developed JPG/TIFF sources.
- `tmp/import-cache` is the ignored disposable import/render workspace. Confirmed-upload preview JPGs can be removed after R2 upload.
- Reserve is manifest-only owner state; local preview asset folders are retired.

## Tracked Media Metadata

- `assets/expo-manifest.json`: public catalog/media manifest.
- `assets/media-sidecar.json`: provenance and public/private key mapping.
- `assets/private-delivery-manifest.json`: private master/render coverage.
- `assets/discarded/discarded-photo-ids.json`: durable owner discard tombstones.
- `assets/discarded-media-manifest.json`: generated discarded-media R2 cleanup record; tracked `Owner.sqlite` keeps trusted R2 object lifecycle state (`current`, `marked_for_delete`, `deleted_confirmed`) for routine cleanup.
- `assets/hidden/hidden-blacklist.json`: current blocked-photo blacklist.
- `assets/owner-actions/keyword-blacklist.json`: SQLite-derived compatibility export for the metadata-only keyword blacklist in `Owner.sqlite`; it removes useless keyword strings but does not filter photos or rewrite JPG/source metadata.
- `assets/owner-actions/country-assignments.jsonl`: SQLite-derived/audit Unknown-to-country move log.
- `assets/owner-actions/country-assignments.json`: SQLite-derived latest Unknown-to-country assignment index.
- `docs/r2-public-cors.json`: public R2 bucket CORS policy used for direct preview browsing.

Do not commit:

- `tmp/**`
- `.review-logs/**`
- `deliveries/**`
- secrets or local credentials
- large local preview/render files unless the pipeline explicitly says they are tracked site assets

## Useful Commands

Regenerate public catalog from current import metadata:

```bash
python3 scripts/export_photos_data.py --external-media
```

Regenerate Worker catalog and media sidecar:

```bash
node scripts/write_worker_catalog.mjs
node scripts/write_media_sidecar.mjs
```

Refresh local SQLite state inspection database:

```bash
python3 scripts/build_photo_state_db.py
open -a "DB Browser for SQLite" tmp/photo-state.sqlite
```

Backfill private delivery render triplets:

```bash
node scripts/sync_private_deliverables.mjs --commit-every 100 --push
```

Repair the live R2 master/derivative chain from source roots before buyer-facing checkout tests:

```bash
zsh -lc 'node scripts/repair_r2_master_chain.mjs --repair --prune'
```

Delete discarded R2 media while preserving tombstones:

```bash
node scripts/delete_discarded_r2_media.mjs --delete
```

Run the full cloud media sweep:

```bash
zsh -lc './scripts/run_cloud_media_sweep.zsh --push'
```

## Checkout / Worker State

- Worker prototype lives in `worker/`.
- Public Worker: `https://photosbyelie-checkout-mock.ec92009.workers.dev`
- Real Stripe is wired behind Worker configuration; mock Stripe remains the local/default path unless Stripe secrets are configured.
- Sandbox Stripe and live Stripe are both manually proven. Live Cloudflare secrets are installed outside git.
- Live webhook destination: `we_1TZmoVPuO9o6fOp6JkBENiyV`, display name `PhotosByElie Worker checkout`, endpoint `https://photosbyelie-checkout-mock.ec92009.workers.dev/stripe-webhook`, event `checkout.session.completed`, API version `2026-04-22.dahlia`.
- Live Stripe receipt branding is saved with `assets/branding/photosbyelie-camera-tripod-logo-512.png`, `assets/branding/photosbyelie-camera-tripod-wordmark.png`, brand `#5B341E`, and accent `#D86A3E`.
- Live card statement descriptor suffix is `DOWNLOAD`.
- Live proof order: `PBE-20260522-BA062E956C`, `cs_live_...`, `pi_3TZtviPuO9o6fOp62QXLbvMF`, `$8.00` paid, order `ready`, one `jpg-1mp` private JPEG delivered.
- Price/offer strategy draft: `docs/commerce/PRICE_OFFER_STRATEGY.md`; no live price changes have been made from that draft.
- Checkout is guest-first and USD-only.
- Worker owns order ID, buyer email, USD total, basket snapshot, status, delivery file metadata, and signed-link-style download tokens.
- Routes currently implemented:
  - `GET /health`
  - `POST /checkout/guest`
  - `POST /checkout/account`
  - `POST /stripe-webhook`
  - `POST /mock-stripe/pay`
  - `GET /orders/:orderId?email=...`
  - `GET /download/:token`

Run Worker checks:

```bash
npm test
npm run validate
```

## Fresh Backlog

### Production panorama landing and country heroes (v143.4)

- The Portugal landing frame is now titled “Cascais meets the Atlantic,” so it
  no longer repeats the Puerto Vallarta frame's “The bay…” opening.
- Each production country card now reveals a responsive destination fan. The
  named choices open that country gallery with its existing search filter; the
  localized “Others…” choice opens the complete country collection.

- Production route: `https://photos-by-elie.com/`. The original review route
  remains available and `noindex` at `/landing-concept/`.
- Elie approved the cutover on July 21. The production root now carries the
  cinematic panorama slideshow, editorial continuation, discovery metadata,
  analytics, policy links, and the normal version surface.
- Six approved outdoor camera panoramas were rendered into clean,
  display-sized JPEG derivatives under `landing-concept/assets/` and the
  shared `assets/gallery-heroes/` directory. Each hero begins at the left
  edge, travels to the right edge at a constant speed over 32 seconds, and
  then crossfades into the next panorama. Pause and reduced-motion states
  suppress that background motion. The indoor Madrid, Orsay, and Malmaison
  scenes were replaced with Solana Beach, Puerto Vallarta, and Cascais Bay;
  France now uses the outdoor Louvre courtyard. These derivatives are
  suitable for edge-to-edge presentation but are not the private
  sale/download masters.
- The production header exposes Photos plus Sign up and Sign in for visitors;
  authenticated accounts see the face icon instead. Google account entry,
  legacy username/password access, password reveal, logout, ACS-driven Real
  Estate routing, and account-backed language/theme preferences are preserved.
- Explore transforms into compact country pills for the six substantial public
  collections: France, USA, Spain, Mexico, Italy, and Portugal. Hover,
  keyboard focus, touch/click, outside-click dismissal, and Escape are covered;
  the mobile fan is horizontally swipeable rather than growing over the hero.
- The continuation below the fold is a six-country editorial grid using
  clean display derivatives. Spain uses the Plaza de España panorama whose
  catalog metadata confirms Seville; Paris now uses the Louvre courtyard at
  night and Nerja uses a sunny coastal cove.
- France, USA, Spain, Mexico, Italy, and Portugal replace the site's fixed
  Nerja-caves backdrop with their own slowly panning country image. The country
  title and filters remain in the normal frosted-glass header above that moving
  page background. Portugal uses the clean Cascais waterfront master. Slovakia
  is deliberately deferred until its collection is deeper; Search, Panoramas,
  and other utility gallery views retain the neutral Nerja-caves backdrop.
- Desktop and compact mobile layouts, visitor/authenticated account states,
  password reveal, slideshow controls, settings, country navigation, saved
  account preferences, and reduced-motion declarations are covered by browser
  QA and `scripts/landing_concept.test.mjs`.

1. Finish full-path plus modified-date re-export overwrite behavior, then audit and clean today's duplicate imports reversibly.
2. Add import source history management for stale/missing remembered folders.
3. Make the Real Estate import control unmistakable and rehearse one full client lifecycle.
4. Finish import dependency/status preflights so failures are actionable before photo queueing.
5. Review and tune buyer support/refund/license wording.
6. Validate the deployed `$8 / $16 / $28 / $65` camera ladder with a controlled live purchase.
7. Curate the first sellable storefront.
8. Add conversion analytics.
9. Improve public discovery and SEO beyond the first-pass `robots.txt` and `sitemap.xml`.
10. Create marketing landing pages and launch outreach.
11. Review the current Owner title/keyword queue, starting with batch `2026-05-24-000237-818Z`.
12. Verify Owner-private artifact separation after deploy.
13. Run the next generator pass after the current batch is resolved.
14. Polish Real Estate production outputs and access model, including optional music for RE videos and Ken Burns-style motion for slideshows.
15. Harden hidden/discarded lifecycle.
16. Extend Owner operations dashboard and state-table browsing.
17. Custom media-domain cutover is complete; keep future preview URLs on `https://download.photos-by-elie.com/media` unless a dedicated media hostname is attached.
18. Keep physical products and long-horizon media cleanup deliberate.
