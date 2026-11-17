import assert from "node:assert/strict";
import test from "node:test";
import { refundHarness, deferred } from "./paid-refund-test-support.mjs";
import { createCatalogIndex, createPhotosByElieWorker } from "./checkout-worker.mjs";

async function assertRefundWon(h) {
  const raw = h.records.get(h.order.id);
  assert.equal(raw.status, "refunded");
  assert.equal(raw.refund.status, "succeeded");
  assert.equal(raw.delivery, null);
  assert.equal(h.downloads.size, 0);
  assert.equal(h.emails.length, 0);
  assert.equal((await h.settlement.fulfillmentFor(h.order.id)).state, "refund_reserved");
  assert.equal(h.database.sqlite.prepare("SELECT count(*) AS n FROM pbe_lifecycle_download_capabilities").get().n, 0);
  assert.equal(h.database.sqlite.prepare("SELECT count(*) AS n FROM pbe_lifecycle_email_dispatches").get().n, 0);
  await assert.rejects(h.fulfillment().fulfillPaidSession(h.session), { code: "refund_blocks_fulfillment" });
  assert.equal(h.records.get(h.order.id).status, "refunded");
}

test("refund after the final KV read and before the ready lifecycle check cannot be erased", async (t) => {
  const h = await refundHarness(t);
  const fulfillment = h.fulfillment({ ...h.settlement, assertAllowed: async (ids, context, fence) => {
    if (context === "fulfillment:before-ready-commit") {
      assert.equal((await h.request()).refundStatus, "succeeded");
    }
    return h.settlement.assertAllowed(ids, context, fence);
  } });
  await assert.rejects(fulfillment.fulfillPaidSession(h.session), { code: "refund_blocks_fulfillment" });
  await assertRefundWon(h);
});

test("the database ready transaction itself loses even after its last authority read", async (t) => {
  const h = await refundHarness(t);
  const batch = h.database.batch.bind(h.database);
  let injected = false;
  h.database.batch = async (statements) => {
    if (!injected && statements.some((s) => /INSERT INTO pbe_lifecycle_fulfillments\s/.test(s.sql))) {
      injected = true;
      await h.request();
    }
    return batch(statements);
  };
  await assert.rejects(h.fulfillment().fulfillPaidSession(h.session), { code: "refund_blocks_fulfillment", status: 409 });
  assert.equal(injected, true);
  await assertRefundWon(h);
});

for (const fails of [false, true]) test(`refund wins during paused renderer ${fails ? "failure" : "success"}`, async (t) => {
  const h = await refundHarness(t), entered = deferred(), release = deferred();
  h.render = async () => { entered.resolve(); await release.promise; if (fails) throw Error("Synthetic renderer failure"); return h.delivery(); };
  const running = h.fulfillment().fulfillPaidSession(h.session);
  await entered.promise;
  await h.request();
  release.resolve();
  await assert.rejects(running, fails ? /Synthetic renderer failure/ : { code: "refund_blocks_fulfillment" });
  await assertRefundWon(h);
});

test("a reservation during an awaited stale preparation KV write preserves the authoritative refund", async (t) => {
  const h = await refundHarness(t);
  const put = h.rawStore.putOrder;
  let injected = false;
  h.rawStore.putOrder = async (order) => {
    if (!injected && order.status === "preparing") {
      injected = true;
      // A concurrent request observes the paid projection while this write is paused.
      h.records.set(order.id, structuredClone(order));
      await h.request();
    }
    return put(order);
  };
  await assert.rejects(h.fulfillment().fulfillPaidSession(h.session), { code: "refund_blocks_fulfillment" });
  await assertRefundWon(h);
});

test("ready winning first refuses a refund even when KV regresses to a pre-ready projection", async (t) => {
  const h = await refundHarness(t);
  await h.fulfillment().fulfillPaidSession(h.session);
  assert.equal((await h.settlement.fulfillmentFor(h.order.id)).state, "ready");
  h.records.set(h.order.id, h.preparing());
  await assert.rejects(h.request(), { code: "refund_not_allowed" });
  assert.equal(h.requests.length, 0);
  assert.equal(h.downloads.size, 1);
});

test("a refund appearing between the order read and settlement read is returned as the authoritative projection", async (t) => {
  const h = await refundHarness(t); await h.begin();
  const original = h.settlement.fulfillmentFor;
  let injected = false;
  const fulfillment = h.fulfillment({ ...h.settlement, fulfillmentFor: async (...args) => {
    if (!injected) { injected = true; await h.request(); }
    return original(...args);
  } });
  const projected = await fulfillment.reconcileOrder(h.preparing());
  assert.equal(projected.status, "refunded");
  assert.equal(projected.refund.status, "succeeded");
  assert.equal(projected.delivery, null);
});

test("all stale failure/ready/email projections remain refund-owned; legacy download flags cannot bypass D1", async (t) => {
  const h = await refundHarness(t);
  await h.begin(); await h.request();
  for (const status of ["preparing", "delivery_failed", "manual_refund_review", "ready"]) {
    const projected = await h.protectedStore.putOrder({ ...h.preparing(), status, delivery: h.delivery(), deliveryEmail: { status: "sent" } });
    assert.equal(projected.refund.status, "succeeded");
    assert.equal(h.records.get(h.order.id).status, "refunded");
    assert.equal(h.records.get(h.order.id).deliveryEmail, undefined);
  }
  h.records.set(h.order.id, { ...h.preparing(), status: "ready", delivery: h.delivery() });
  h.downloads.set("dl_stale", { token: "dl_stale", orderId: h.order.id, photoId: "synthetic-photo", lifecycleSettlementBound: false });
  const worker = createPhotosByElieWorker({ catalog: createCatalogIndex({ collections: {} }), store: h.rawStore,
    stripe: h.stripe, lifecycleDenyStore: h.settlement,
    delivery: { createDelivery: async () => assert.fail("Must not render"), getDownloadResponse: async () => assert.fail("Refunded bytes must not be read") } });
  const response = await worker.fetch(new Request("https://worker.test/download/dl_stale"));
  assert.equal(response.status, 410);
  assert.equal((await response.json()).error.code, "order_refunded");
  await assert.rejects(h.settlement.assertDownloadCapability({ orderId: h.order.id, token: "dl_stale" }), { code: "refund_blocks_fulfillment" });
});
