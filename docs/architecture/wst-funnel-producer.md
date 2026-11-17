# PBE-225 local producer candidate

This is source preparation for the private WST funnel, based on accepted PBE-221
`92e753f74b1e60b4932cf64b41aaf210451ceb7f` (v321.7). Parent owns the integrated
release identity. The receiver contract is `docs/pbe-funnel-contract.md` in WST
candidate `fe59d1063f1783129654e0b4ea22e630d38d2dc4`. No production adoption,
collection enablement, migration, provider query or buyer rehearsal follows from
these local synthetic checks. WST-22 live-test holds remain in force.

## Browser

`analytics.js` remains the sessionless storefront adapter. Its existing
`photosByElieAnalytics.enabled()` stays false for native analytics, and its
`track()` accepts only `product_ready` and `basket_add` for the new WST extension.
They map to `event_name: pbe_stage`, with only the stage as caller-supplied data.
The beacon constructs the finite route, locale and acquisition dimensions.

The funnel is **off by default**. An enabling release must explicitly add
`data-wst-pbe-funnel="true"` to its `analytics.js` script tag after verifying
receiver adoption. No active source page opts in. The adapter forwards this
flag to the beacon, which also rejects stages when the flag is absent/false.
With the flag off, no new event shapes or acquisition fields reach the old
collector. PBE no longer transmits arbitrary campaign labels or referrer hosts.
Other tenants retain their canonical beacon behavior.

`product_ready` fires once per document after a lifecycle-authorized public
photo is still present, its image has usable dimensions, recovery has finished,
and purchase options are rendered. Cached and delayed image loads use the same
latch. Shells, load failures, revoked/hidden/private identities and video
metadata alone are not photo readiness. Readiness is not a claim that a private
original or every backend output has been validated for checkout.

`basket-store.js` reports a newly persisted product option only when the caller
explicitly marks a UI mutation `userInitiated`. Photo, liked and basket option
handlers supply that marker. Restore, generic write, liked navigation flush,
repaint, existing options, changed quantities/frames, removals, rejected options
and failed storage writes do not count. Bulk liked selection counts each photo
mutation that actually adds an option. A synchronous shared mutation latch
prevents reentrant tracking from duplicating a selection.

The adapter preserves the exact production origin, generated photo/gallery route
normalization, Owner/local/IPv6/mesh/preview exclusions and DNT/GPC suppression.
It also suppresses webdriver and known bot agents. Pending stages are bounded
to 50 in memory while the beacon loads, with privacy rechecked before transport.
Nothing persists to session storage or across pages. The canonical beacon's
finite `acquisition_source` describes only current-page arrival. It is not
first-touch, buyer attribution, or a count of people. Failed beacon/fetch
transport is silent; fallback reuses the same event ID and payload.

## Private binding RPC

`wstFunnelSnapshot()` is a WorkerEntrypoint method, with no new public HTTP
route. It requires the existing Stripe configuration, order KV and lifecycle D1
bindings. `wstCommerceSnapshot()`, its schema and its readers remain unchanged.

The exact output is:

```json
{
  "schema_version": "wst.pbe-funnel.v1",
  "site_id": "photosbyelie",
  "observed_at": "2026-11-17T15:00:00.000Z",
  "days": [
    {"day": "2026-11-15", "stage": "payment_accepted", "provenance": "unknown", "currency": "USD", "count": 1}
  ]
}
```

This example is synthetic. Every snapshot is a complete replacement projection
of supported currently retained orders, not an additive event feed or a recovery
of expired history. Observation time is captured at read start so a slower old
read cannot acquire a newer timestamp merely by finishing later. WST owns atomic
replacement, same-time conflict and stale-observation handling.

All `pbe:orders:*` keys/values (or the configured KV prefix) are read completely.
Each retained Stripe checkout is retrieved through the existing provider GET
reader, validating exact order/session references, provider mode, amount and
currency. Missing provider data and contradictory evidence fail the whole RPC.
Shared checkout/payment references across different order records also fail.
Real Estate original-delivery records, local drafts, explicit mock sessions and
provider test-mode sessions are outside this production projection.

Stage evidence is deliberately separate:

- `checkout_created`: a provider-validated retained Checkout Session, using the
  provider's `created` time. This is not the local draft's creation time.
- `payment_accepted`: the same session is provider-confirmed paid/complete and
  matches the stored paid amount, with the retained validated-fulfillment
  `paidAt`. Missing `paidAt` leaves acceptance unmeasured, including payment that
  has not reached retained paid fulfillment. Retries can delay this retained
  timestamp; it is not a reconstruction of Stripe's original payment instant.
  Native `payment_completed` events are never acceptance evidence.
- `delivery_ready`: accepted payment plus retained `readyAt`, a ready order,
  complete distinct files for its purchased products, and current lifecycle
  settlement/asset checks. Refund workflow, revocation or lifecycle hold prevents
  readiness. Unavailable authority fails the RPC. This describes retained ready
  fulfillment, not email receipt, successful download, current token expiry,
  download allowance or a fresh check of the object bytes.

Each order contributes at most once per stage, regardless of webhook replay or
file count. Payment acceptance remains an accepted-payment event after a refund;
it is not net revenue. A measured revocation/failure/refund can yield zero for an
evidenced delivery day. No zero is synthesized for a missing timestamp or an
unmeasured day/stage/currency/provenance. If revocation discarded historical
`readyAt`, that cell is omitted. A ready claim with missing/malformed required
evidence fails closed.

All provenance stays `unknown`: the retained PBE order contract supplies no
verified classification authority. Email addresses, coupons, owner flags, raw
metadata and provider test mode cannot prove `owner_test` or `external`. No IDs,
buyer fields, raw URLs/UTMs or private metrics appear in the response or source.

Read limits are explicit: 100 KV pages, 100 keys per page, 1,000 retained records,
1 MiB per record, 8 MiB total record bytes, four concurrent value/provider reads, 100 purchased products
per ready order and at most 10,000 aggregate cells. Key/cursor replay, truncation,
missing records, malformed evidence or a limit breach fails the RPC rather than
returning a partial projection. KV's consistency model and concurrent source
changes still apply; this is a complete bounded scan, not a transactional source
freeze. A bounded protocol revision is needed before expanding these limits.

## Integration boundary

Only two imports and the new RPC method are added to `worker/cloud-worker.mjs`.
The existing HTTP delegation, workflow and commerce method are untouched.
`stripe-client.mjs`, `kv-store.mjs`, `wst-commerce-snapshot.mjs`, paid fulfillment
and the broader Worker runtime are unchanged. Reconcile these narrow hunks onto
the parent-owned deployed-authority Worker, including later refund/lifecycle/
checkpoint/nativevideo/Tilbury features. **Never deploy this whole accepted-old
Worker merely to adopt the RPC.**

Rollout remains receiver/migration first, reviewed reconciled PBE RPC second,
browser flag last after receiver acceptance. Roll back the flag/producer first.
No new database schema or account permissions are introduced here. Parent owns
release versioning, ticket updates, shared time and any production receipts.

Run `npm run test:pbe-funnel` for focused synthetic and retained regression
checks; these new tests are also registered in `npm test`. Private synthetic
integration receipts stay under ignored `tmp/pbe-225-evidence/`.
