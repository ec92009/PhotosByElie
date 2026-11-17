# Untouched legacy identity reconciliation (PBE-213)

`POST /api/v1/lifecycle/reconcile-legacy-identity` is a connector-only,
explicit recovery operation. It is not part of the ordinary daily runner.
Migration 0017 adds only an immutable repair-receipt table; no identity is
changed by deployment or migration. Owner sessions and public callers cannot
invoke this operation. Request bytes are bounded to 64 KiB for both phases.

Use only when fresh exact observation reports an identity mismatch, the cloud
identity is independently verified as a historical self-ID (asset ID equals
media ID), and current Owner has one unambiguous native binding to the exact
approved original and both existing public previews. Never infer native
identity from filename, dimensions, title or a similar photo.

The local caller must freshly validate current approval, fixture policy,
source revision, exact receipt hashes and remote original/preview bytes for
every item before apply. Bind that source and authority evidence into the
request; preserve the current weekly selection. This API does not verify
Owner-local source facts on behalf of the caller or approve a photo.

## Two-phase request

Both phases require stable `repairId`, boolean `prepareOnly`, and 1–20 `items`.
Each item has `canonicalMediaId`, `previousAssetId` (must equal media ID),
`canonicalAssetId` (new exact current Owner identity), `sourceSha256`,
`authoritySha256`, and the exact two public `bindings`:
`expo/<media-id>_900.jpg` and `expo/<media-id>_1800.jpg`.

Prepare with `prepareOnly:true`. Persist the returned plan's `envelope`.
Apply the identical request with `prepareOnly:false` and `envelope` added.
`actorId` is supplied by authentication; a caller cannot select it.
After a lost response, prepare the same repair ID/items again. Applied repairs
return their original envelope; replay returns the durable original receipt
without changing any row. Reconcile current visibility independently.

## Safety boundaries

- Only untouched visible revision-0 self-IDs qualify. Denials, restore history,
  barriers, lifecycle receipts and paid fulfillment references reject repair.
- Target identities already owned by any other item are rejected.
- No media ID, public/private object binding, object bytes, approval, purchase,
  or deny decision is changed. Current projection identity and revision advance;
  old evidence becomes stale and must not be reused as a publication grant.
- Preparation verifies the complete current manifest digest. Apply recomputes
  it, compares the exact envelope, and atomically checks global epoch and all
  per-item fences, including paid-fulfillment races.
- Constraint failure rolls back the entire batch. No partial identity repairs
  or success markers remain. The manifest digest/counts and immutable repair
  receipt change in that same transaction. Counts/bindings remain unchanged.
- Never roll back via raw SQL or erase the repair receipt. Later lifecycle
  denial remains authoritative, including during replay of an old repair.

After recovery, run fresh whole-subject readiness. Only then may the separately
authorized exact MP4 host/campaign workflow proceed. Neither tests, deployment,
applied repair nor connected credentials mean a video or campaign is live.

## Local runtime validation

The source includes the D1 compound-query limit correction from `f9ea66fd`.
`worker/legacy-identity-runtime.test.mjs` uses real local D1 to prepare, apply
and replay six synthetic mappings without reading or writing production state.
Source and mock/runtime checks do not establish production migration or grant
permission to correct any real identity.
