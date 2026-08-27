# Country + Title/Keyword Review

Date: 2026-08-13

Ticket: PBE-153

Status: investigation complete; no Country runtime implementation exists;
PBE-155 is blocked by PBE-154's identity and migration gate

## Decision

Country belongs in the native Backstage **Review** metadata editor as a third
peer field beside Title and Keywords. It uses the same editable-draft,
autosave, per-field down-arrow propagation, AI-proposal, approval, and guarded
undo lifecycle.

The accepted Country remains authoritative in `country_assignments`, while AI
and existing metadata provide editable suggestions only. Extending the shared
Review operation may update title, keywords, and Country in one audited SQLite
transaction, but AI output never becomes accepted without Owner action.

Do not extend the localhost web Owner pages as the long-term solution. The current
product boundary is narrower than the older Owner Anywhere North Star wording:

- Backstage is a Mac app and may run on any enrolled Mac.
- Launching through Backstage is the only normal way to act as Owner.
- Direct Google sign-in as `ec92009@gmail.com` may only create a show-once
  Backstage device credential, list its non-secret metadata, or revoke it
  (rotation is revoke then create); it cannot perform Owner workflow actions.

This refinement still advances the commercial North Star: it shortens the Apple
Photos intake-to-curated-catalog path without introducing another state writer.
The ticket's mobile requirement therefore means a usable narrow Backstage window,
not a new tablet/browser Owner surface.

## Current paths and authorities

| Workflow | Current surface | Read path | Mutation path | Durable state |
| --- | --- | --- | --- | --- |
| Country assignment | `owner-review.html?view=unknown`, rendered by `unknown-classifier.js` | Unknown/Reserve browser data plus the compatibility `country-assignments.json` index | `hidden-actions.js:assignUnknownsToCountry` -> localhost `assign-country` in `scripts/local_server.py` | `Owner.sqlite:country_assignments`, with JSON/JSONL compatibility exports |
| Legacy title/keyword review | `owner-review.html?view=title-keywords`, rendered by `title-keyword-review.js` | `/__photosbyelie/title-keyword-review-queue` built by `title_keyword_review_queue_payload` | `save-title-keyword-review-approvals` and `apply-title-keyword-review-approvals` | `title_keyword_queue`, `title_keyword_proposals`, and `title_keyword_decisions`; applied metadata is in the public catalog |
| Native fixture Review | `ReviewView.swift`, with `ReviewInspector` and `ReviewTitleKeywordEditor` | `FixtureWorkflowService.reviewWindow` -> `fixture-review-window` -> `fixture_review_window` | Worker action -> enrolled local connector -> `fixture-review-apply`; undo through `fixture-review-undo` | fixture placement, `asset_editorial_state`, `sidecar_decisions`, `asset_ai_proposals`, and `fixture_review_operations` |

The native Review contract already establishes the right boundary: Backstage is
an action submitter and private-media reader, while the connector owns validated
SQLite transactions and receipts.

## Observed data gap

Read-only snapshot from the canonical `Owner.sqlite` and compatibility index on
2026-08-13:

| Evidence | Count |
| --- | ---: |
| `sidecar_assets` | 115,204 |
| `asset_editorial_state` | 115,204 |
| `title_keyword_queue` | 130 |
| `catalog_collection_resolutions` | 247 |
| `public_catalog_publications` | 286 |
| `country_assignments` | 0 |
| legacy `country-assignments.json` rows | 1,553 |

The 247 collection resolutions are 212 Spain, 26 Portugal, and 9 USA. The
legacy country index contains 475 Portugal, 434 Mexico, 343 USA, 249 France,
and 52 Spain assignments.

The important blocker is identity, not layout:

- none of the 1,553 legacy country IDs directly match a native
  `sidecar_assets.asset_id`;
- none directly match a `public_catalog_publications.media_id`;
- none of the 130 legacy title/keyword queue IDs directly match either native
  asset IDs or publication media IDs;
- `FixtureReviewItem` currently carries native asset identity but no Country;
- the connector's `photo-moderation` payload does not forward `gallery_key` or
  `country`, and its native fixture routes have no Country operation.

Normal code calls `import_country_assignments` before the first country write,
which backfills SQLite only while the table is empty. A combined reader must not
silently treat the empty table as complete, and it must not retain JSON as a
second normal source of truth after migration.

No filename, capture-date, location-text, or visual similarity inference is an
acceptable identity bridge. Until an explicit mapping exists, legacy rows must
remain preserved but unmapped.

## Proposed Backstage layout

### Normal window

The existing Review inspector remains one scrollable column:

1. Preview and filename.
2. One metadata editor containing Country, Title, and Keywords as peer fields.
3. AI-proposal context for all three fields.
4. Existing editorial actions and status.
5. Existing AI-review reasons and supporting controls.

```text
┌─ Editorial ───────────────────────────┐
│              Preview                 │
│ filename.jpg                         │
├─ Proposed metadata ───────────────────┤
│ Country                        [ ↓ ]  │
│ [ Spain                           ▾ ] │
│ Suggested · catalog resolver / AI    │
│ Title                          [ ↓ ]  │
│ [ Paris after the crowds          ]  │
│ Keywords                       [ ↓ ] │
│ [ Paris, Louvre, night, ...       ]  │
│ AI proposal context · editable draft │
├───────────────────────────────────────┤
│ [Approve] [Hide] [Unpick] [Needs AI] │
└───────────────────────────────────────┘
```

The Country row contains:

- a labelled picker with the editable proposed value;
- the same down-arrow control as Title and Keywords;
- accepted/current Country, or **Unknown**, available to the draft comparison;
- a compact source label for an existing assignment, catalog/geocoder
  resolution, structured location evidence, or AI proposal;
- the existing Review saved, retrying, conflict, and error status behavior.

The arrow saves the focused draft if needed and propagates Country through the
same server-computed, fixture-bounded two-hour shoot window used by Title and
Keywords. The app does not submit an authoritative expanded ID list. A missing
capture timestamp yields no following propagation targets.

### Narrow Backstage window

Country, Title, and Keywords stack in document order. Each field heading keeps
its down arrow beside it while its editor becomes full-width. No field is hidden
behind a compact menu, and existing decision controls may wrap without
reordering their meaning.

## State and save semantics

### Authority and identity

`Owner.sqlite:country_assignments` remains the sole current-state authority for
explicit Country. Before native writes are enabled, its identity contract must
be migrated from legacy public `media_id` values to the durable Review asset
identity, with every legacy value either:

1. mapped through reviewed, deterministic identity evidence; or
2. retained as an explicit unmapped migration row/audit item.

The migration may evolve the table schema, but it must not create a second
current-state Country table. A separate append-only operation/history table is
allowed because it is a receipt, not competing current state.

After migration, JSON is regenerated only as a compatibility/audit view. Normal
Backstage reads and writes use SQLite.

### Effective value and suggestions

- An explicit assignment is the accepted/current Country.
- **Unknown** means there is no explicit assignment; it is not stored as a fake
  country row.
- Existing assignment, `catalog_collection_resolutions`, structured source
  location, and fixture metadata are allowable suggestion inputs with visible
  provenance. An explicit assignment remains the current value.
- AI may propose a Country alongside proposed Title and Keywords, using the
  same bounded image/context input and model provenance. It remains an editable
  draft.
- A manual or AI suggestion never changes accepted Country until the normal
  Review edit/approve action is applied.
- Choosing Unknown deliberately clears the assignment through an audited
  Review operation; it does not delete suggestion or resolution history.

### Save, correction, and application

Extend the existing connector-owned `fixture-review-apply` contract:

1. `FixtureReviewItem` returns current Country, proposed Country, suggestion
   source, and AI provenance beside title and keywords.
2. Backstage keeps `reviewCountry` in the same local draft object as title and
   keywords and submits an explicit Country-change marker so empty means a
   deliberate clear rather than an omitted field.
3. `edit-metadata` autosave accepts Country, Title, and Keywords; unchanged
   fields are preserved.
4. `approve` accepts the focused asset's active proposal/draft for all three
   fields in one connector-owned SQLite transaction.
5. `propagate-country` follows the existing title/keyword propagation contract
   and records exact before/after snapshots in `fixture_review_operations`.

These operations support first assignment, correction, clearing to Unknown,
idempotent retry, and guarded undo. This intentionally differs from the legacy
`assign-country` action, which only moves Unknown photos into a country Reserve
collection and rewrites catalog state.

Country edit, approval, or propagation does not directly publish or rewrite the
public catalog. The publication pipeline consumes the accepted assignment later.
Correcting an already published asset marks its publication/delivery projection
as needing an update, but deployment remains a separate action.

### Cohort propagation

Country uses the exact per-field propagation behavior already exposed for Title
and Keywords:

- editing the focused field autosaves that asset through `edit-metadata`;
- pressing its down arrow then applies `propagate-country` to eligible following
  assets in the same fixture-bounded two-hour shoot window;
- each target receives the Country value only; Title and Keywords are untouched;
- a missing anchor timestamp yields no following targets;
- retry with the same idempotency key returns the original receipt rather than
  applying the operation twice.

### Undo and recovery

Country undo follows the `fixture_review_operations` safety model:

- restore the exact before snapshot for the recorded targets in one transaction;
- refuse an older undo when a target no longer matches that operation's after
  snapshot;
- record undo as an audited event and make retries idempotent;
- restore Country together with any title/keyword values in the recorded Review
  operation without discarding later drafts, selection, page, or focus.

The legacy JSON/JSONL files are not an undo mechanism.

## Interaction with review, navigation, and counts

- Country is a peer proposed metadata field, but it remains optional for
  title/keyword editing and approval. An Owner may make a sound editorial
  decision before resolving location.
- Public-gallery publication readiness requires an accepted Country. Private or
  delivery-only fixtures may explicitly allow Unknown through fixture policy.
- `FixtureReviewSummary` gains a separate **Country missing** count. It remains
  independent of unreviewed, requesting AI, proposed, and approved counts.
- Manual Country autosave or Country-only propagation updates only Country and
  the Country-missing count; it does not approve the row or auto-advance.
- Approve accepts an active proposed Country together with the active Title and
  Keywords draft. If Country remains Unknown, required public rows become
  **approved, not publication-ready**.
- AI Country output follows the existing proposal lifecycle: ready/loaded draft,
  explicit Owner acceptance or edit, and superseded/rejected history.
- Existing Approve/Hide behavior keeps its current navigation semantics.
- Fixture changes, searches, and paging reload Country through the same bounded
  Review window projection.

## Keyboard and accessibility contract

- Country has the same explicit label, field/arrow grouping, help text, and
  logical VoiceOver order as Title and Keywords.
- The picker uses native menu semantics; the down arrow's accessible name is
  **Propagate country through the active two-hour shoot scope**.
- Autosave, propagation, approval, and undo results use the existing polite
  Review status without moving VoiceOver or keyboard focus.
- Focus remains on the Country picker or arrow that initiated the action.
- Existing unmodified `A`, `H`, and `U` Review shortcuts remain unchanged and do
  not fire while focus is inside an editable control.
- The first implementation adds no unmodified Country shortcut. Tab, picker
  arrows, Space, and Return retain native behavior.
- Narrow-window reflow preserves source order and does not duplicate controls.

## Bounded implementation plan

PBE-154 owns Gate 0. PBE-155 owns Phases 1-4 and remains blocked until PBE-154
delivers a reviewed, deterministic identity migration. This investigation
specifies that future work; it does not implement a Country runtime path.

### PBE-154 / Gate 0: identity and migration

1. Add a read-only migration report for the 1,553 legacy assignments that
   classifies every row as deterministically mapped or unmapped.
2. Define the durable asset-ID representation in `country_assignments` and an
   idempotent SQLite migration.
3. Backfill SQLite, verify exact source/target counts, preserve unmapped rows,
   and only then retire JSON reads from normal paths.
4. Add integrity checks that reject guessed, duplicate, or conflicting identity
   mappings.

This PBE-154 gate blocks PBE-155 runtime implementation today.

### PBE-155 / Phase 1: connector-owned Country contract

- Extend `scripts/owner_state_db.py` with read, set/correct/clear, receipt, and
  guarded undo operations.
- Extend the fixture Review projection and shared `fixture-review-apply` /
  `edit-metadata` contracts in `scripts/fixture_pipeline.py`, routing them
  through `scripts/new_owner_connector.py`.
- Add `propagate-country` with the same server-computed, fixture-bounded
  two-hour shoot-window contract as title and keyword propagation.
- Extend the AI proposal schema and generator so Country can be proposed with
  title and keywords while retaining model, source, and suggestion provenance.
- Keep `scripts/local_server.py` and its legacy `assign-country` behavior intact
  until the native cutover is verified.

### PBE-155 / Phase 2: native model and state

- Extend `FixtureReviewItem` and `FixtureReviewSummary` in
  `FixtureWorkflowService.swift` with current and proposed Country,
  suggestion/source and AI provenance, Country-missing state/count, and
  operation results.
- Extend the existing Review metadata draft in `BackstageViewModel.swift` with
  `reviewCountry`; use the same autosave, refresh, proposal acceptance,
  propagation, and guarded-undo lifecycle as title and keywords.
- Preserve an explicit Country-change marker throughout encoding so omitted,
  deliberately cleared, and unchanged values remain distinct.

### PBE-155 / Phase 3: Backstage UI

- Add Country as the first peer row inside `ReviewTitleKeywordEditor` in
  `ReviewCanvasInspector.swift`, with the same labelled field and down-arrow
  grouping as Title and Keywords.
- Show accepted value, suggested value/source, and active AI proposal without
  adding a separate scope or save control.
- Preserve current selection, Quick Look, metadata autosave, AI proposal,
  editorial actions, and focus behavior.
- Verify normal and narrow layouts before removing any legacy navigation.

### PBE-155 / Phase 4: cutover and retirement

- Compare native and legacy Country projections on a reviewed fixture.
- Make Backstage the normal Country entry point.
- Retire the old web Country writer in a separate change only after migration,
  correction, undo, and publication handoff have production evidence.

## Automated test matrix

| Area | Required proof |
| --- | --- |
| Migration | Empty SQLite plus 1,553-row JSON imports exactly once; rerun is idempotent; unmapped rows are preserved and reported; normal reads stop consulting JSON |
| Identity | Native asset, legacy media, and publication IDs map only through deterministic evidence; duplicates/conflicts fail closed; no filename/date fallback |
| Read projection | Explicit assignment wins; resolution appears only as suggestion; no assignment renders Unknown; Country-missing summary is accurate under search/filter/paging |
| Single save | First assignment, correction, and clear each write one current-state result and one receipt |
| Field propagation | Country arrow uses the same fixture-bounded two-hour shoot window as Title/Keywords; missing capture time produces no following targets; only Country changes; batch is atomic |
| Idempotency | Retrying the same action returns the original result without duplicate events or writes |
| Undo | Exact before state restores atomically; repeat undo is harmless; stale undo conflicts instead of overwriting a newer change |
| Shared draft safety | Country autosave/propagation preserves unchanged Title/Keywords; combined approval applies the active three-field draft atomically; editorial state, selection, focus, offset, and fixture remain stable |
| Publication boundary | Required Unknown blocks public readiness but not T/K approval; Country correction marks an existing publication for later update without publishing |
| Connector | Worker action validates fixture, asset, country, scope, and count; Backstage never writes business rows directly |
| AI proposal | Country proposal carries model/source provenance, loads as an editable draft, and never becomes accepted without Owner action |
| Native models | JSON decode/encode covers current/proposed/suggested Country, explicit clear, Unknown, missing count, operation result, and error/conflict cases |
| View model | Autosave/propagate/undo patches loaded items and summary in place; stale responses cannot overwrite a newer fixture/window request |

Run the focused Python connector/database tests, `scripts/fixture_pipeline_test.py`,
`scripts/fixture_connector_test.py`, native `OwnerCoreTests`, and the repository's
full Node/Python validation required by current policy.

## Manual acceptance matrix

On a candidate build, with no deployment implied:

1. Verify the Country row appears at the same level as Title and Keywords in a
   normal Backstage window and remains clean at the narrowest supported width.
2. Verify a long filename, long fixture name, suggestion, and status do not clip
   controls or reorder VoiceOver reading.
3. Assign one Unknown asset; confirm the value/count update, no auto-advance, and
   an untouched title/keyword draft.
4. Correct that asset to another country, then undo; confirm exact restoration.
5. Clear to Unknown and confirm public readiness changes while editorial approval
   does not.
6. Press the Country down arrow; confirm only eligible following assets in the
   two-hour shoot window change, then undo the exact batch.
7. Exercise an offline connector, retry, and stale-undo conflict; verify actionable
   inline messages and no partial UI claim.
8. Use keyboard-only and VoiceOver navigation through Country, its propagation
   arrow, title, keywords, and existing Review actions.
9. Change fixture, filter, and page; verify the correct Country projection and
   preserved Review selection/focus rules.
10. Load an AI Country proposal, edit it, accept it, and confirm the proposal's
    model/source provenance remains inspectable and no value is auto-accepted.
11. Confirm no catalog publication, Photos write-back, or deployment occurs from
    Country autosave or propagation alone.

## Conclusion

One-page Country plus title/keyword review is desirable and consistent with the
Backstage-only Owner direction. The UI work is straightforward; the current
identity split and incomplete SQLite backfill are the real constraints. Complete
PBE-154's Gate 0 first; PBE-155 can then implement Country as a peer,
AI-assisted proposed metadata field inside native Review.
