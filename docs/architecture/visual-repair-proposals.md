# Visual repair proposal boundary

PBE-144 is implemented as a local, draft-only seam inside the RE fixture
review subtree. A request must resolve to an RE-rooted fixture chain, an
active picked review asset, and the exact immutable `asset_source_versions`
row used as its original. Visual proposal provenance is stored in the
authoritative `Owner.sqlite` tables `visual_repair_proposals` and
`visual_repair_events`; no JSON file is a source of truth.

The production generator remains intentionally unavailable. On 2026-08-27 the
Owner explicitly approved one bounded OpenAI pass using synthetic imagery only.
The retained test pair and privacy-safe prompt summary live under
`native/PhotosByElieBackstage/Tests/OwnerCoreTests/Fixtures/PBE144SyntheticOpenAI/`.
No Photos asset, client image, real property image, credential, or canonical
Owner row was sent to the provider.

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
synthetic Owner database. A future real-image production generator still needs
a separate privacy/provider decision and is not enabled by this proof.

Accept records a draft decision only. It does not write Photos metadata,
replace a source version, alter title/keywords, ratings, fixture decisions,
delivery, upload, or publication state. Reject marks the derived reference
unavailable while retaining audit provenance; regenerate supersedes the old
draft and creates a new attempt tied to the same source version. Rejected and
superseded references are therefore discarded from comparison without any
source rollback or media deletion operation.

The RE Space-bar surface is a read-only comparison. Non-RE Quick Look and all
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
Neither operation touches an original or canonical Owner state. Production
generation remains off after the acceptance fixture is discarded.
