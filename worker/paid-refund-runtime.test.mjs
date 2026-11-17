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
