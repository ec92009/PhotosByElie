import assert from "node:assert/strict";
import test from "node:test";
import { refundHarness, deferred } from "./paid-refund-test-support.mjs";
import { createPaidOrderRefund } from "./paid-order-refund.mjs";
import { createPaidOrderFulfillment } from "./paid-order-fulfillment.mjs";
import { createCatalogIndex, createPhotosByElieWorker } from "./checkout-worker.mjs";
import { buildWstFunnelSnapshot } from "./wst-funnel-snapshot.mjs";
import { funnelFixture } from "./wst-funnel-fixture.mjs";

const event = (h, status, attempt = 1, amount = 800) => ({ id: `re_synthetic_${attempt}`, status, amount, currency: "usd",
  payment_intent: h.session.payment_intent, metadata: { order_id: h.order.id, refund_attempt: String(attempt) } });

test("simultaneous pre-reservation reads have one atomic refund winner and one provider request", async (t) => {
  const h = await refundHarness(t); await h.begin();
  const reserve = h.settlement.reservePaidRefund, both = deferred();
  let entered = 0;
  h.settlement.reservePaidRefund = async (...args) => {
    if (++entered === 2) both.resolve(); await both.promise; return reserve(...args);
  };
  const results = await Promise.allSettled([h.request(), h.request()]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.find((r) => r.status === "rejected").reason.code, "refund_not_allowed");
  assert.equal(h.requests.length, 1);
});

test("webhook success between eligibility and reservation cannot be downgraded using its newer revision", async (t) => {
  const h = await refundHarness(t); await h.begin();
  const read = h.settlement.refundOrderFor;
  let reads = 0;
  h.settlement.refundOrderFor = async (id) => {
    if (++reads === 2) await h.refund.applyRefundEvent(event(h, "succeeded"));
    return read(id);
  };
  await assert.rejects(h.request(), { code: "refund_not_allowed" });
  assert.equal(h.requests.length, 0);
  assert.equal(h.records.get(h.order.id).status, "refunded");
});

test("duplicate pending refund cannot call the provider twice; late pending cannot regress webhook success", async (t) => {
  const h = await refundHarness(t), entered = deferred(), release = deferred();
  await h.begin();
  h.provider = async () => { entered.resolve(); await release.promise; return event(h, "pending"); };
  const first = h.request(); await entered.promise;
  await assert.rejects(h.request(), { code: "refund_not_allowed" });
  await h.refund.applyRefundEvent(event(h, "succeeded"));
  release.resolve();
  assert.equal((await first).refundStatus, "succeeded");
  assert.equal(h.requests.length, 1);
  assert.equal(h.records.get(h.order.id).status, "refunded");
});

test("unknown provider responses keep the permanent hold and retry the same exact attempt/key", async (t) => {
  const h = await refundHarness(t); await h.begin();
  h.provider = async () => { throw Error("Synthetic timeout with unknown provider outcome"); };
  h.stripe.listRefunds = async () => { if (h.requests.length) throw Error("Synthetic reconciliation unavailable"); return []; };
  await assert.rejects(h.request(), { code: "stripe_refund_unknown" });
  assert.equal(h.records.get(h.order.id).refund.status, "unknown");
  assert.equal((await h.settlement.fulfillmentFor(h.order.id)).state, "refund_reserved");
  await assert.rejects(h.fulfillment().fulfillPaidSession(h.session), { code: "refund_blocks_fulfillment" });
  h.provider = async () => event(h, "succeeded");
  h.stripe.listRefunds = async () => [];
  await h.refund.requestRefund(h.order.id, { confirmationOrderId: h.order.id, reason: "Different retry wording" });
  assert.deepEqual(h.requests[1], h.requests[0], "unknown retry preserves all original Stripe parameters");
  assert.equal(h.records.get(h.order.id).refund.attempt, 1);
  assert.equal(h.records.get(h.order.id).status, "refunded");
  assert.equal(h.downloads.size, 0); assert.equal(h.emails.length, 0);
});

test("definitive rejection may retry with a new attempt, but no failure releases delivery exclusion", async (t) => {
  const h = await refundHarness(t); await h.begin();
  h.provider = async () => { throw Object.assign(Error("Synthetic definitive rejection"), { details: { stripeStatus: 400 } }); };
  await assert.rejects(h.request(), { code: "stripe_refund_failed" });
  assert.equal(h.records.get(h.order.id).refund.status, "failed");
  await assert.rejects(h.fulfillment().fulfillPaidSession(h.session), { code: "refund_blocks_fulfillment" });
  h.provider = async () => event(h, "pending", 2);
  await h.request();
  assert.notEqual(h.requests[1].idempotencyKey, h.requests[0].idempotencyKey);
  await h.refund.applyRefundEvent(event(h, "failed", 1));
  assert.equal(h.records.get(h.order.id).refund.status, "pending");
  await h.refund.applyRefundEvent(event(h, "succeeded", 1));
  assert.equal(h.records.get(h.order.id).refund.status, "succeeded");
  await h.refund.applyRefundEvent(event(h, "failed", 2));
  assert.equal(h.records.get(h.order.id).refund.status, "succeeded");
  assert.equal(h.records.get(h.order.id).refund.attempt, 2);
});

test("expired unknown attempts retain exclusion without reusing a potentially pruned provider key", async (t) => {
  const h = await refundHarness(t); await h.begin();
  h.provider = async () => { throw Error("Synthetic timeout"); };
  await assert.rejects(h.request(), { code: "stripe_refund_unknown" });
  const current = await h.settlement.refundOrderFor(h.order.id);
  const stale = structuredClone(current.order);
  stale.refund.requestedAt = "2026-11-15T12:00:00Z";
  await h.settlement.savePaidRefund(stale, current.revision);
  await assert.rejects(h.request(), { code: "refund_not_allowed" });
  assert.equal(h.requests.length, 1);
  assert.equal((await h.settlement.fulfillmentFor(h.order.id)).state, "refund_reserved");
});

test("provider partial refund cannot regress to failed or permit over-refunding", async (t) => {
  const h = await refundHarness(t); await h.begin();
  h.refunds.push(event(h, "succeeded", 1, 200));
  assert.equal((await h.refund.preview(h.order.id)).refundStatus, "partial");
  await h.refund.applyRefundEvent(event(h, "failed"));
  assert.equal(h.records.get(h.order.id).refund.status, "partial");
  await assert.rejects(h.request(), { code: "refund_not_allowed" });
  assert.equal(h.requests.length, 0);
});

test("missing authority, missing migration and unregistered legacy paid orders refuse provider refunds", async (t) => {
  const h = await refundHarness(t);
  h.records.set(h.order.id, h.preparing());
  await assert.rejects(h.request(), { code: "refund_not_allowed" });
  const absent = createPaidOrderRefund({ orderStore: h.rawStore, stripe: h.stripe, time: { now: h.now } });
  await assert.rejects(absent.requestRefund(h.order.id, { confirmationOrderId: h.order.id, reason: "No authority" }), { code: "refund_authority_unavailable" });
  h.database.sqlite.exec("DROP TABLE pbe_paid_order_settlements");
  await assert.rejects(h.request(), { code: "refund_authority_unavailable" });
  await assert.rejects(h.fulfillment().fulfillPaidSession(h.session), { code: "refund_authority_unavailable" });
  const noAuthority = createPaidOrderFulfillment({ orderStore: h.rawStore, deliveryRenderer: { createDelivery: async () => assert.fail("No authority") },
    time: { now: h.now }, email: { sendReady: async () => assert.fail("No authority") }, analytics: { record: async () => {} },
    downloadPolicy: () => ({}), applyDownloadPolicy: (f) => f, mediaIdsForOrder: () => [] });
  await assert.rejects(noAuthority.fulfillPaidSession(h.session), { code: "refund_authority_unavailable" });
  assert.equal(h.requests.length, 0); assert.equal(h.downloads.size, 0); assert.equal(h.emails.length, 0);
});

test("PBE-225 stale ready projections are zero under refund holds; unknown authority fails the whole snapshot", async (t) => {
  const h = await refundHarness(t); await h.begin(); await h.request();
  const stale = { ...h.preparing(), status: "ready", lifecycleSettlementBound: true, delivery: h.delivery() };
  const f = funnelFixture([stale]); f.lifecycle = h.settlement; f.sessions.set(h.session.id, h.session);
  assert.equal((await buildWstFunnelSnapshot(f)).days.find((r) => r.stage === "delivery_ready").count, 0);
  h.database.sqlite.exec("DROP TABLE pbe_paid_order_settlements");
  await assert.rejects(buildWstFunnelSnapshot(f), { code: "refund_authority_unavailable" });
});

test("PBE-225 rechecks a refund that arrives during its awaited lifecycle verification", async (t) => {
  const h = await refundHarness(t);
  await h.fulfillment().fulfillPaidSession(h.session);
  const f = funnelFixture([h.records.get(h.order.id)]); f.sessions.set(h.session.id, h.session);
  f.lifecycle = { ...h.settlement, assertAllowed: async (...args) => {
    const fence = await h.settlement.assertAllowed(...args);
    await h.refund.applyRefundEvent(event(h, "succeeded"));
    return fence;
  } };
  assert.equal((await buildWstFunnelSnapshot(f)).days.find((r) => r.stage === "delivery_ready").count, 0);
});

test("unknown legacy ready projections cannot replay delivery or email without a ready authority row", async (t) => {
  const h = await refundHarness(t);
  h.records.set(h.order.id, { ...h.preparing(), status: "ready", delivery: h.delivery() });
  await assert.rejects(h.fulfillment().fulfillPaidSession(h.session), { code: "refund_authority_unavailable" });
  assert.equal(h.emails.length, 0); assert.equal(h.downloads.size, 0);
  const fence = await h.settlement.assertAllowed(["synthetic-photo"], "legacy-control");
  await h.settlement.commitFulfillmentReady({ orderId: h.order.id, mediaIds: ["synthetic-photo"], fence });
  assert.equal((await h.fulfillment().fulfillPaidSession(h.session)).status, "ready", "verified existing ready rows retain idempotent replay");
  assert.equal(h.emails.length, 1);
  await assert.rejects(h.request(), { code: "refund_not_allowed" });
  assert.equal(h.requests.length, 0);
});

for (const failEmail of [false, true]) test(`external refund during an already claimed email ${failEmail ? "failure" : "success"} cannot erase the refund`, async (t) => {
  const h = await refundHarness(t), entered = deferred(), release = deferred();
  const worker = createPhotosByElieWorker({ catalog: createCatalogIndex({ collections: {} }), store: h.rawStore,
    lifecycleDenyStore: h.settlement, now: h.now, stripe: { ...h.stripe, constructEvent: async () => ({ type: "checkout.session.completed", data: { object: h.session } }) },
    delivery: { createDelivery: async () => h.delivery() }, emailClient: { send: async () => {
      entered.resolve(); await release.promise; if (failEmail) throw Error("Synthetic email failure"); return { messageId: "synthetic" };
    } } });
  const running = worker.fetch(new Request("https://worker.test/stripe-webhook", { method: "POST", body: "{}" }));
  await entered.promise;
  await h.refund.applyRefundEvent(event(h, "succeeded"));
  release.resolve();
  const response = await running;
  assert.equal(response.status, 409);
  assert.equal(h.records.get(h.order.id).status, "refunded");
  assert.equal(h.records.get(h.order.id).refund.status, "succeeded");
  assert.equal(h.records.get(h.order.id).delivery, null);
});

for (const stage of ["post-ready", "capability", "ready-projection"]) test(`fulfillment resumes after a ${stage} KV failure without reopening refunds`, async (t) => {
  const h = await refundHarness(t);
  const putOrder = h.rawStore.putOrder, putDownload = h.rawStore.putDownload;
  let faulted = false;
  h.rawStore.putOrder = async (value) => {
    const ready = (await h.settlement.fulfillmentFor(h.order.id))?.state === "ready";
    if (!faulted && ready && ((stage === "post-ready" && value.status === "preparing")
      || (stage === "ready-projection" && value.status === "ready"))) {
      faulted = true; throw Error("Synthetic projection outage");
    }
    return putOrder(value);
  };
  h.rawStore.putDownload = async (value) => {
    if (!faulted && stage === "capability") { faulted = true; throw Error("Synthetic projection outage"); }
    return putDownload(value);
  };
  await assert.rejects(h.fulfillment().fulfillPaidSession(h.session), /Synthetic projection outage/);
  assert.equal((await h.settlement.fulfillmentFor(h.order.id)).state, "ready");
  await assert.rejects(h.request(), { code: "refund_not_allowed" });
  assert.equal((await h.fulfillment().fulfillPaidSession(h.session)).status, "ready");
  assert.equal(h.requests.length, 0);
  assert.equal(h.downloads.size, 1); assert.equal(h.emails.length, 1);
});

test("ready recovery requires the exact paid identity and a matching ready lifecycle fence", async (t) => {
  const h = await refundHarness(t); await h.begin();
  const fence = await h.settlement.assertAllowed(["synthetic-photo"], "recovery-test");
  await h.settlement.commitFulfillmentReady({ orderId: h.order.id, mediaIds: ["synthetic-photo"], fence });
  await assert.rejects(h.settlement.beginPaidFulfillment(h.preparing()), { code: "refund_not_allowed" });
  await assert.rejects(h.settlement.beginPaidFulfillment(h.preparing(), { digest: "f".repeat(64) }), { code: "refund_not_allowed" });
  await assert.rejects(h.settlement.beginPaidFulfillment({ ...h.preparing(), amountPaid: 799 }, fence), { code: "refund_not_allowed" });
  await h.settlement.beginPaidFulfillment(h.preparing(), fence);
  h.database.sqlite.exec("UPDATE pbe_lifecycle_fulfillments SET state='manual_refund_review'");
  await assert.rejects(h.settlement.beginPaidFulfillment(h.preparing(), fence), { code: "refund_not_allowed" });
});

test("refund mirror failure recovers immediately using the original held request", async (t) => {
  const h = await refundHarness(t); await h.begin();
  const put = h.rawStore.putOrder; let faulted = false;
  h.rawStore.putOrder = async (value) => {
    if (!faulted && value.status === "refund_pending") { faulted = true; throw Error("Synthetic KV outage before handoff"); }
    return put(value);
  };
  await assert.rejects(h.request(), { code: "stripe_refund_unknown" });
  assert.equal(h.requests.length, 0);
  const reserved = (await h.settlement.refundOrderFor(h.order.id)).order.refund;
  assert.equal(reserved.status, "unknown");
  await assert.rejects(h.fulfillment().fulfillPaidSession(h.session), { code: "refund_blocks_fulfillment" });
  assert.equal((await h.refund.requestRefund(h.order.id, { confirmationOrderId: h.order.id, reason: "Changed retry wording" })).refundStatus, "succeeded");
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].idempotencyKey, reserved.idempotencyKey);
  assert.equal(h.requests[0].metadata.support_reason, reserved.reason);
  assert.equal(h.requests[0].metadata.refund_attempt, "1");
  assert.equal(h.downloads.size + h.emails.length, 0);
});

for (const age of [59_999, 60_000, 23 * 60 * 60 * 1000, -1]) test(`interrupted pending handoff recovery respects lease and key lifetime at age ${age}`, async (t) => {
  let clock = Date.parse("2026-11-17T13:00:00Z");
  const h = await refundHarness(t, { now: () => new Date(clock) }); await h.begin();
  // Model a stopped process after the reservation committed, before the next await.
  const reserve = h.settlement.reservePaidRefund;
  h.settlement.reservePaidRefund = async (...args) => { await reserve(...args); throw Error("Synthetic process interruption"); };
  await assert.rejects(h.request(), /Synthetic process interruption/);
  h.settlement.reservePaidRefund = reserve;
  const original = (await h.settlement.refundOrderFor(h.order.id)).order.refund;
  clock += age;
  if (age === 60_000) {
    const reserved = deferred(), release = deferred();
    h.provider = async () => { reserved.resolve(); await release.promise; return event(h, "succeeded"); };
    const retry = h.refund.requestRefund(h.order.id, { confirmationOrderId: h.order.id, reason: "Different wording" });
    await reserved.promise;
    await assert.rejects(h.request(), { code: "refund_not_allowed" });
    assert.equal(h.requests[0].idempotencyKey, original.idempotencyKey);
    assert.equal(h.requests[0].metadata.support_reason, original.reason);
    assert.equal(h.requests[0].metadata.refund_attempt, "1");
    release.resolve(); assert.equal((await retry).refundStatus, "succeeded");
    assert.equal(h.requests.length, 1);
  } else {
    await assert.rejects(h.request(), { code: "refund_not_allowed" });
    assert.equal(h.requests.length, 0);
  }
  await assert.rejects(h.fulfillment().fulfillPaidSession(h.session), { code: "refund_blocks_fulfillment" });
  assert.equal(h.downloads.size + h.emails.length, 0);
});

test("provider-confirmed pending refunds are never replayed when the local handoff lease expires", async (t) => {
  let clock = Date.parse("2026-11-17T13:00:00Z");
  const h = await refundHarness(t, { now: () => new Date(clock) }); await h.begin();
  h.provider = async () => event(h, "pending");
  await h.request(); clock += 60_000;
  await assert.rejects(h.request(), { code: "refund_not_allowed" });
  assert.equal(h.requests.length, 1);
});
