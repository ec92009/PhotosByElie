# Visual repair proposal boundary

PBE-144 is implemented as a local, draft-only seam inside the RE fixture
review subtree. A request must resolve to an RE-rooted fixture chain, an
active picked review asset, and the exact immutable `asset_source_versions`
row used as its original. Visual proposal provenance is stored in the
authoritative `Owner.sqlite` tables `visual_repair_proposals` and
`visual_repair_events`; no JSON file is a source of truth.

## Production generation (PBB-184)

Backstage can generate a real visual draft from an explicit saved RE visual
request. Generate visual draft exports one fresh 1800-pixel PhotoKit preview
through the signed app's exact-asset capability, then starts a bounded worker.
The worker uses OpenAI's Image Edits API and `gpt-image-2.5-sunburst` at medium
quality. This image model is separate from the text/keyword model ladder; the
request retains that ladder's rung and snapshot, while `resolvedModel` and the
provider receipt identify the actual image editor. No metadata pass is started.

The personal credential is read from Keychain service
`PhotosByElie OpenAI Image API` (or `OPENAI_API_KEY` for a configured test process).
No credential is embedded in the app, manifest, command arguments or repository.
API reference: https://developers.openai.com/api/reference/resources/images/methods/edit

Drafts retain queued/running/failed/cancelled/ready generation state, a decoded
PNG, before/after SHA-256 identities, request receipt and immutable source binding.
The exact captured before image is used in comparison. Artifacts remain private
under `assets/owner-actions/visual-repair-artifacts`; Owner.sqlite is authoritative.
Capture and completion revalidate the saved reasons, current source version and
fixture decision. Duplicate requests attach to the current operation. Provider
calls serialize and are never automatically retried after uncertain outcomes.
A failed run can be retried explicitly; workers older than twenty minutes are
reported as expired. Cancellation prevents attachment, though an in-flight
provider request may finish. Regeneration keeps the previous draft until its
replacement succeeds. Viewing, generating and accepting a draft do not approve
metadata, replace originals, upload or publish anything.

The retained synthetic test pair from the separately approved 2026-08-27 test
is under `native/PhotosByElieBackstage/Tests/OwnerCoreTests/Fixtures/PBE144SyntheticOpenAI/`.

Tests may explicitly enable the synthetic seam with
`PBE_ENABLE_SYNTHETIC_VISUAL_REPAIR=1`. The proposal request still creates only
deterministic references. A separate materialization step may then attach the
approved before/after files to a draft when all of these fail-closed conditions
hold:

- both files are regular supported images inside the disposable fixture root;
- their SHA-256 identities differ and are stored with the proposal;
- the provider receipt begins with `openai-synthetic://`;
- the exact RE fixture, picked asset, and immutable source version still resolve;
- the proposal is still an unmaterialized draft; existing rendered drafts are
  never overwritten.

The original source identity remains `immutable-source-version://…`.
`originalPreviewReference` is only a rendered comparison aid and cannot replace
that identity. The native comparison falls back to this test-only file when no
PhotoKit preview exists, allowing installed acceptance against a disposable
synthetic Owner database. The synthetic materializer cannot attach files to production requests; real-image
generation uses the separate validated production path described above.

Accept records a draft decision only. It does not write Photos metadata,
replace a source version, alter title/keywords, ratings, fixture decisions,
delivery, upload, or publication state. Reject marks the derived reference
unavailable while retaining audit provenance; regenerate supersedes the old
draft and creates a new attempt tied to the same source version. Rejected and
superseded references are therefore discarded from comparison without any
source rollback or media deletion operation.

Each RE Review photo has a Before / After button over its thumbnail. It opens
a read-only overlay comparison with a draggable divider: original on the left,
visual draft on the right. Both images retain their full fitted geometry as the
mask moves. Left/right arrows and accessibility adjustment move the divider in
five-percent steps. Space opens the same comparison for the focused photo.
When no rendered proposal exists, only the original appears, labeled No after
image yet; no divider or simulated result is shown. Non-RE Quick Look and all
existing review actions retain their previous behavior.

## Disposable acceptance fixture

`scripts/pbe144_synthetic_visual_fixture.py` creates a new or empty data root,
copies the retained synthetic pair into that root, creates one RE child fixture
and picked synthetic asset, records the immutable source version, requests the
draft, and materializes the SHA-bound provider receipt. It refuses to replace a
non-empty root. Launching a candidate app with `PBE_REPO_ROOT` set to that data
root exercises the normal Review UI while leaving canonical `Owner.sqlite`,
Photos, fixture decisions, catalog, upload, and publication state untouched.

Rollback is deletion of the disposable data root or rejection of its draft.
Neither operation touches an original or canonical Owner state. A disposable fixture never implicitly authorizes real-photo generation.

## Personal build verification — 2026-09-19

PBB-183 shipped locally as Backstage v262.0, build 337, from commit
`f8954bdf8e559498be5dc15dc88280db7737e1f9` on `release/backstage`.
The signed bundle replaced `/Applications/PhotosByElie Backstage.app`; the
previous bundle is retained as `.PhotosByElie Backstage.pre-337-20260919T222622.app`.

- Debug and signed release builds passed; the release runtime preview smoke passed.
- All three `visualRepair` OwnerCore tests passed.
- An isolated harness using the production comparison view and retained synthetic
  fixture images verified the overlaid layers, dragging from 22 to 75 percent,
  a left-arrow adjustment to 70 percent, and accessibility increment to 75 percent.
- Installed build 337 showed Before / After inside each RE Review thumbnail.
  The second photo's action opened that photo, and Space opened the selected first photo.
- Actual photos without rendered drafts show one original and “No after image yet.”
  Production image generation remains unconfigured. No generation, approval, upload,
  publication, or photo-state action was performed for this verification.
- This was a direct personal installation; the cloud updater manifest still points
  to the older build and safely rejects a downgrade.


## Production generator verification — 2026-09-20

PBB-184 is installed locally as Backstage v263.0 build 340 from commit
`3a0a08dbc2bfad3e7a26530494c7dc6047c64cf2`. The signed application is
`/Applications/PhotosByElie Backstage.app`; the previous build is retained at
`/Applications/.PhotosByElie Backstage.pre-340-20260920T102725.app`.

- The release build and signed-runtime 900/1800-pixel preview smoke passed.
  Existing verification passed 24 visual Python tests, 14 Photos-capability tests,
  and three Swift visual-repair tests. The final narrow-connection regression
  suite passed all 12 production tests, including no library-wide backfills.
- The installed app generated a real corridor-photo draft from its previously
  saved visual request. Capture/preparation reached running in 0.49 seconds;
  the complete persisted result took 15.31 seconds. Both real-photo drafts
  (the earlier laundry photo and this corridor photo) are ready, remain drafts,
  and have distinct, verified before/after SHA-256 identities. The generated
  images are 1536 by 1024 pixels; provider receipts record the actual model.
- The per-photo Before / After action displayed the actual rendered images.
  Dragging moved the overlay divider and Left adjusted it by five percent;
  accessibility reported 65 percent original after those actions.
- Fresh component hashes matched for all four checked source/index records:
  raw metadata, editorial state, fixture decisions, and immutable source versions.
  Generation did not approve, upload, publish, or replace an original.
- Generation uses a bounded connection to the established Owner database and
  migrates only its own draft tables. It does not rerun full-library schema
  backfills. Read-only configuration and proposal polling bypass the connector's
  mutation lock.
- Build 339 was interrupted before producing the final installation when the
  user paused. Build 340 carries a fresh release identity. This is a direct
  personal installation; no cloud updater or public site release is implied.
