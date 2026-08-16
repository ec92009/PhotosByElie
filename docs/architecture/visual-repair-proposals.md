# Visual repair proposal boundary

PBE-144 is implemented as a local, draft-only seam inside the RE fixture
review subtree. A request must resolve to an RE-rooted fixture chain, an
active picked review asset, and the exact immutable `asset_source_versions`
row used as its original. Visual proposal provenance is stored in the
authoritative `Owner.sqlite` tables `visual_repair_proposals` and
`visual_repair_events`; no JSON file is a source of truth.

The current generator is intentionally unavailable in production. Tests may
explicitly enable the synthetic generator with
`PBE_ENABLE_SYNTHETIC_VISUAL_REPAIR=1`; it writes only deterministic reference
strings and never sends or retains image bytes, prompts, credentials, or real
private media. A future production generator must pass a separate privacy and
provider review before this gate changes.

Accept records a draft decision only. It does not write Photos metadata,
replace a source version, alter title/keywords, ratings, fixture decisions,
delivery, upload, or publication state. Reject marks the derived reference
unavailable while retaining audit provenance; regenerate supersedes the old
draft and creates a new attempt tied to the same source version. Rejected and
superseded references are therefore discarded from comparison without any
source rollback or media deletion operation.

The RE Space-bar surface is a read-only comparison. Non-RE Quick Look and all
existing review actions retain their previous behavior.
