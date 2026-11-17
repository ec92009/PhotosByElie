import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { createD1LifecycleDenyStore, summarizeLifecycleManifest } from "./lifecycle-deny-store.mjs";
import { createPaidOrderRefund } from "./paid-order-refund.mjs";

/** Actual local D1 transactions, trigger parsing and session metadata; no remote bindings. */
test("workerd D1 enforces refund/readiness exclusion, CAS outcomes and guarded legacy writes", async () => {
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "refund-settlement-test", modules: true,
    script: 'export default { fetch() { return new Response("local only"); } };',
    compatibilityDate: "2026-07-10", d1Databases: ["DB"] }] }));
  try {
    const database = await mf.getD1Database("DB");
    for (const file of ["0012_lifecycle_deny_plane.sql", "0013_lifecycle_manifest_reconciliation.sql", "0018_paid_refund_settlement.sql"]) {
      await database.exec(fs.readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8").replace(/^--.*$/gm, "").replace(/\s+/g, " "));
    }
    const settlement = createD1LifecycleDenyStore({ database });
    const members = [{ canonicalAssetId: "asset-synthetic", canonicalMediaId: "synthetic-photo",
      bindings: [{ bucket: "public", objectKey: "expo/synthetic-photo_900.jpg" }] }];
    await settlement.seedVisibleBatch({ seedId: "runtime-refund-seed", items: members });
    await settlement.activate({ activationId: "runtime-refund-active", ...await summarizeLifecycleManifest(members) });
    const fence = await settlement.assertAllowed(["synthetic-photo"], "runtime-refund");
    const orderFor = (id) => ({ id, checkoutSessionId: `cs_${id}`, paymentIntentId: `pi_${id}`, amountPaid: 800,
      amountExpected: 800, currency: "usd", status: "preparing" });
    const orders = new Map(); let requests = 0;
    const stripe = { retrieveCheckoutSession: async (id) => ({ id, client_reference_id: id.slice(3),
      payment_status: "paid", amount_total: 800, currency: "usd", payment_intent: `pi_${id.slice(3)}` }),
    listRefunds: async () => [], createRefund: async (options) => {
      requests++;
      return { id: "re_synthetic", status: "succeeded", amount: 800, currency: "usd",
        payment_intent: options.paymentIntentId, metadata: options.metadata };
    } };
    const refund = createPaidOrderRefund({ settlement, stripe, time: { now: () => new Date() },
      orderStore: { getOrder: async (id) => orders.get(id), putOrder: async (o) => { orders.set(o.id, o); return o; } } });
    const request = (id) => refund.requestRefund(id, { confirmationOrderId: id, reason: "Synthetic runtime cancellation" });
    const order = orderFor("refund-first"); orders.set(order.id, order);
    await settlement.beginPaidFulfillment(order);
    assert.equal((await request(order.id)).refundStatus, "succeeded");
    await assert.rejects(settlement.commitFulfillmentReady({ orderId: order.id, mediaIds: ["synthetic-photo"], fence }), { code: "refund_blocks_fulfillment" });
    // A caller using the previous SQL cannot bypass the exclusion trigger.
    await assert.rejects(database.prepare(`INSERT INTO pbe_lifecycle_fulfillments
      (order_id,fence_digest,state,created_at,updated_at) VALUES (?,?,'ready','synthetic','synthetic')`).bind(order.id, fence.digest).run(), /refund_blocks_fulfillment/);
    assert.equal((await settlement.fulfillmentFor(order.id)).state, "refund_reserved");
    const ready = orderFor("ready-first"); orders.set(ready.id, ready);
    await settlement.beginPaidFulfillment(ready);
    await settlement.commitFulfillmentReady({ orderId: ready.id, mediaIds: ["synthetic-photo"], fence });
    await assert.rejects(request(ready.id), { code: "refund_not_allowed" });
    assert.equal(requests, 1);
    assert.equal((await settlement.fulfillmentFor(ready.id)).state, "ready");
    const count = await database.prepare("SELECT count(*) AS n FROM pbe_lifecycle_download_capabilities").first();
    assert.equal(count.n, 0);
  } finally { await mf.dispose(); }
});

for (const scenario of ["ready-projection", "refund-mirror", "interrupted-reservation"]) test(`workerd D1 recovers ${scenario} while retaining settlement exclusion`, async (t) => {
  const { refundHarness } = await import("./paid-refund-test-support.mjs");
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "refund-recovery-test", modules: true,
    script: 'export default { fetch() { return new Response("local only"); } };',
    compatibilityDate: "2026-07-10", d1Databases: ["DB"],
    outboundService: async () => { throw Error("External network forbidden in refund recovery tests"); } }] }));
  t.after(() => mf.dispose());
  const database = await mf.getD1Database("DB");
  for (const file of ["0012_lifecycle_deny_plane.sql", "0013_lifecycle_manifest_reconciliation.sql", "0018_paid_refund_settlement.sql"]) {
    await database.exec(fs.readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8").replace(/^--.*$/gm, "").replace(/\s+/g, " "));
  }
  let clock = Date.parse("2026-11-17T13:00:00Z");
  const h = await refundHarness(t, { database, now: () => new Date(clock) });
  if (scenario === "ready-projection") {
    const put = h.rawStore.putOrder; let faulted = false;
    h.rawStore.putOrder = async (value) => {
      if (!faulted && value.status === "preparing" && (await h.settlement.fulfillmentFor(h.order.id))?.state === "ready") {
        faulted = true; throw Error("Synthetic post-ready KV failure");
      }
      return put(value);
    };
    await assert.rejects(h.fulfillment().fulfillPaidSession(h.session), /Synthetic post-ready KV failure/);
    await assert.rejects(h.request(), { code: "refund_not_allowed" });
    assert.equal((await h.fulfillment().fulfillPaidSession(h.session)).status, "ready");
    assert.equal(h.downloads.size, 1); assert.equal(h.emails.length, 1); assert.equal(h.requests.length, 0);
    assert.equal((await database.prepare("SELECT state FROM pbe_paid_order_settlements WHERE order_id=?").bind(h.order.id).first()).state, "ready");
  } else {
    await h.begin();
    if (scenario === "refund-mirror") {
      const put = h.rawStore.putOrder; let faulted = false;
      h.rawStore.putOrder = async (value) => {
        if (!faulted && value.status === "refund_pending") { faulted = true; throw Error("Synthetic refund mirror failure"); }
        return put(value);
      };
      await assert.rejects(h.request(), { code: "stripe_refund_unknown" });
    } else {
      const reserve = h.settlement.reservePaidRefund;
      h.settlement.reservePaidRefund = async (...args) => { await reserve(...args); throw Error("Synthetic interruption"); };
      await assert.rejects(h.request(), /Synthetic interruption/);
      h.settlement.reservePaidRefund = reserve;
      await assert.rejects(h.request(), { code: "refund_not_allowed" });
      clock += 60_000;
    }
    assert.equal(h.requests.length, 0);
    const original = (await h.settlement.refundOrderFor(h.order.id)).order.refund;
    assert.equal((await h.request()).refundStatus, "succeeded");
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].idempotencyKey, original.idempotencyKey);
    assert.equal(h.requests[0].metadata.support_reason, original.reason);
    await assert.rejects(h.fulfillment().fulfillPaidSession(h.session), { code: "refund_blocks_fulfillment" });
    assert.equal(h.downloads.size + h.emails.length, 0);
    assert.equal((await database.prepare("SELECT count(*) AS n FROM pbe_lifecycle_download_capabilities").first()).n, 0);
  }
});
