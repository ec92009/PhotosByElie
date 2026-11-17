# Paid refund and fulfillment exclusion

Source fix `513823a400cd4241327a8cc69d92499038d08dfe` follows integrated base
`82fb10655323789b5dbfc5775128cf223487e9a5`. It corrects PBE-221 review A1:
a completed refund could be overwritten by fulfillment's stale ready KV write
after the last refund read. Another KV read cannot serialize those operations.
This document is a source/rollout contract, not deployment evidence.

## Shared authority and ordering

Additive migration `0018_paid_refund_settlement.sql` adds
`pbe_paid_order_settlements` in the existing ACCESS_DB. It binds an order to its
validated Checkout Session, payment intent, amount and currency, with state,
CAS revision and a private refund-order projection. No existing order is
backfilled, no catalog/Owner table is changed and no new service is introduced.
The existing fulfillment table's constrained states remain unchanged.

1. After payment validation and lifecycle checks, `beginPaidFulfillment` records
   preparing authority before any preparation KV write or renderer call.
2. Before a provider refund request, `reservePaidRefund` atomically changes that
   exact identity from preparing to refund. Concurrent readiness, existing
   capabilities/email claims, stale revisions, confirmed pending/successful refunds
   and unknown legacy authority refuse reservation. A refused reservation makes no
   provider refund request.
3. The existing ready transaction atomically marks the guard ready using D1
   triggers. If refund reserved first, ready insert/update, capability insert
   and email-claim insert cannot authorize access. If ready won first, the
   pre-delivery refund loses. These checks apply even to the earlier ready SQL.
4. `fulfillmentFor` reads lifecycle settlement and refund exclusion in one
   primary-backed query. A refund returns `refund_reserved` regardless of a
   stale KV status. Capabilities/downloads and email claims retain authoritative
   exclusion. Lifecycle restoration cannot revive a held order.

A failed KV write after the ready transaction can resume fulfillment only when
its validated payment identity and current lifecycle fence exactly match the
existing ready settlement. The guard remains ready throughout recovery; no
retry resets it to preparing or reopens pre-delivery refund eligibility. Missing,
revoked or different-fence settlements refuse recovery.

The new table is needed for a durable reservation before readiness and for
revisioned refund evidence. The companion table and triggers avoid rebuilding
the existing lifecycle settlement/foreign-key tables.

## Projections, outcomes and retries

`refund-protected-order-store.mjs` overlays D1's refund projection on order
reads and all Worker preparation, failure, ready, email and redemption writes.
It repairs a stale KV write against a fresh primary revision after the awaited
write. Contention/unavailable authority fails closed; KV is never the exclusion
lock. The durable D1 hold remains authoritative even if KV repair is interrupted.
Downloads check the hold independently of a legacy KV settlement-bound flag,
including after an awaited private-object read, before returning bytes.

Refund outcomes use CAS. Success does not regress; a late full success remains
decisive across attempts; partial refunds cannot regress to a failed/retryable
state. Verified refund webhooks/provider reconciliation can record a hold for
an already-ready or legacy order: this is evidence of a provider outcome, not
permission to initiate another refund. Existing ready authority is then blocked.

No failure releases the exclusion. A definitive provider rejection can retry
with a new attempt/key. Network errors, 5xx responses and unavailable follow-up
reads retain an unknown outcome. An explicitly confirmed unknown retry reuses
the original attempt, key, reason and complete parameters within 23 hours;
older or future-dated attempts require provider reconciliation and do not make
another refund request. A caught pre-provider KV mirror failure also records an
unknown outcome in D1, retaining the hold even if the fallback KV write fails.

A process interrupted after reservation may leave pending authority without a
provider refund ID. Explicit confirmation can resume that same request after a
60-second handoff lease, within the original 23-hour key lifetime. The CAS
reservation validates the original attempt, key, requested time and reason,
and renews the handoff timestamp without changing the original requested time.
Confirmed provider-pending refunds are reconciled, never reissued. A long-running
original request and a recovered request can overlap after the lease; provider
idempotency with identical parameters and authoritative CAS preserve correctness.
The lease limits overlapping handoffs; it is not the refund exclusion lock.

 Stripe API v1 can prune idempotency keys after
24 hours, so reusing a sufficiently old key is not proof of deduplication.
[Stripe idempotent request contract](https://docs.stripe.com/api/idempotent_requests)

Ready winning first prevents pre-delivery refund initiation. An independently
verified external refund can arrive after an email was already claimed/sent;
that dispatch cannot be recalled. Its later success/failure projection still
cannot erase the refund or restore downloads. Tests distinguish that case from
a refund reservation winning before readiness, which issues no capability/email.

## Fail-closed and PBE-225 compatibility

Missing migration, unavailable authority or a legacy order without participating
preparation authority cannot initiate a refund. A ready KV projection without
ready authoritative settlement cannot replay fulfillment/email. Existing known
ready settlements retain idempotent replay and existing download verification.
The factories default to requiring authority. Only the explicit local mock
adapter/unit fixtures opt into unsettled mock fulfillment; real Stripe and the
deployed adapter do not. Refund operations always require D1 authority.

PBE-225 recognizes `refund_reserved` as no ready delivery, rereads settlement
after awaited lifecycle verification, and requires settlement-schema readiness
even for an empty retained cohort. Unknown authority rejects the complete
snapshot. Existing commerce/funnel private binding RPCs, response schemas and
Tilbury dispatch remain intact. No receiver/WST source changes are included.

## Local validation

- `paid-refund-race.test.mjs`: original final-read/ready race, refund during the
  actual ready transaction, renderer success/failure pauses, paused KV writes,
  ready-first refusal, read reconciliation and stale download/email projections.
- `paid-refund-outcomes.test.mjs`: simultaneous reservations, pending duplicates,
  webhook/CAS races, terminal/partial monotonicity, rejection/unknown retry keys,
  expired attempts, interrupted handoff lease boundaries, failed KV recovery,
  exact-identity/fence readiness replay, legacy/missing authority and PBE-225 readiness.
- `paid-refund-runtime.test.mjs`: actual local workerd D1 parses the migration,
  enforces the triggers against earlier ready SQL, verifies both winners and
  reproduces recovery after readiness, refund-mirror failure and interruption.
- `worker-release-runtime.test.mjs`: actual combined class entrypoint preserves
  binding-only commerce/funnel RPCs, blocked unknown authority and Tilbury/PBE.

The v321.9 source passed its registered checks but independent review found two
recovery regressions. The follow-up adds explicit fault-injection regressions to
the existing required suites. Consult the parent release receipt for final test
counts and source identity. Providers, KV-shaped stores and email sinks are
synthetic; D1/SQLite databases are disposable.

## Parent rollout and rollback contract

1. Keep refund initiation quiesced during adoption; drain pre-fix in-flight
   refund/fulfillment work and avoid mixed old/new refund writers. Verify the
   active complete Worker source/version, bindings and rollback identity under
   the parent's existing release gate. Source tests do not supply that receipt.
2. Review/apply only the intended additive 0018 migration under separately
   authorized production operations, before adopting the fixed Worker. Retain
   existing lifecycle tables, bindings, provider settings and exclusion data.
   The fixed paid paths and funnel RPC intentionally fail closed without 0018.
3. Adopt the complete guard-aware Worker, including projection/download paths,
   refund orchestration and PBE-225 readiness, as one reviewed release. Preserve
   provider webhook subscriptions and verify their separately authorized outcomes.
   The parent assigns the next artifact identity and reruns the full release gate.
4. Retain the table/triggers/holds on rollback. Use a guard-aware rollback build;
   do not reenable unguarded refund code or drop/reset reservations. If no such
   rollback is available, keep affected mutations refused pending reconciliation.

No migration, deployment, provider operation, real payment/refund/email,
credential access, canonical database or shared timelog change is performed by
this source fix. Historical production/source gates remain independent.
