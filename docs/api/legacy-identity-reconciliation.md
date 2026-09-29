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

## Scoped release verification — 29 September 2026

The new suite has 21 passing cases, including multi-item late rollback and a
paid-fulfillment intent arriving immediately before the transaction. The full
suite passed 985 checks before four additional race checks were added and passed
separately. The generated API 1.6.0 contract covers 49 operations/19 schemas.
Wrangler's release-check build and dry run passed without deployment.

One historical recovery fixture now explicitly clears preview byte counts only
in its disposable catalog. It must model missing metadata independently of the
real catalog photo having been successfully repaired. No production recovery
logic changes with that fixture correction.

Live preflight found unrelated migration `0015_google_oauth_transactions.sql`
still pending. Do not blanket-apply migrations. Use a temporary migration-only
config with the existing D1 ID and default ledger, containing only the exact
reviewed 0017 file (SHA-256
`8ffb11bf9a01ff90828807933aaf2e57df454807318fe65a7a1e96976dba8072`).
The pending plan must contain only that file. Deploy only with the full existing
Worker config and `--keep-vars`; preserve both existing custom domains, bindings,
secrets and enabled catalog-authority/video guards. The pre-release rollback
Worker version is `fd084bc0-5148-4a8d-bc41-e0eb1b79b4f8`; fresh-check it before
use and retain the additive receipt table. Deployment alone changes no identity.

Actual deployment, exact per-photo apply and readback belong in the dated
Córdoba operational receipt. This source verification is not a live receipt.
