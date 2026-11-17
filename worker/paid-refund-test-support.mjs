import { createD1LifecycleDenyStore, summarizeLifecycleManifest } from "./lifecycle-deny-store.mjs";
import { TestD1 } from "./campaign-video-test-support.mjs";
import { createPaidOrderFulfillment } from "./paid-order-fulfillment.mjs";
import { createPaidOrderRefund } from "./paid-order-refund.mjs";
import { refundProtectedOrderStore } from "./refund-protected-order-store.mjs";
import { syntheticOrder, syntheticSession } from "./wst-funnel-fixture.mjs";

/** Real settlement algorithms and disposable SQLite; no provider or real KV. */
export async function refundAuthority(now = () => new Date(), database = new TestD1()) {
  const settlement = createD1LifecycleDenyStore({ database, now });
  const members = [{ canonicalAssetId: "asset-test", canonicalMediaId: "synthetic-photo", bindings: [
    { bucket: "public", objectKey: "expo/synthetic-photo_900.jpg" },
  ] }];
  await settlement.seedVisibleBatch({ seedId: "synthetic-seed", items: members });
  await settlement.activate({ activationId: "synthetic-activation", ...await summarizeLifecycleManifest(members) });
  return { database, settlement };
}

export function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

/** Deterministic seams around the real D1 reservation/readiness algorithms. */
export async function refundHarness(t, { now = () => new Date("2026-11-17T13:00:00Z"), database: suppliedDatabase } = {}) {
  const { database, settlement } = await refundAuthority(now, suppliedDatabase);
  if (!suppliedDatabase) t.after(() => database.sqlite.close());
  const order = syntheticOrder("synthetic", { items: [{ photoId: "synthetic-photo", products: [{ id: "jpg-1mp" }] }] });
  const session = syntheticSession(order, { payment_status: "paid", status: "complete" });
  const records = new Map([[order.id, structuredClone(order)]]);
  const downloads = new Map(), emails = [], requests = [], refunds = [];
  const rawStore = {
    getOrder: async (id) => structuredClone(records.get(id)),
    putOrder: async (value) => { records.set(value.id, structuredClone(value)); return value; },
    getDownload: async (token) => downloads.get(token),
    putDownload: async (value) => { downloads.set(value.token, structuredClone(value)); return value; },
  };
  const h = { database, settlement, order, session, records, rawStore, downloads, emails, requests, refunds, now };
  const stripe = {
    retrieveCheckoutSession: async () => session,
    listRefunds: async () => structuredClone(refunds),
    createRefund: async (options) => {
      requests.push(structuredClone(options));
      if (h.provider) return h.provider(options);
      const refund = { id: "re_synthetic", status: "succeeded", amount: options.amount, currency: "usd",
        payment_intent: session.payment_intent, metadata: options.metadata, created: 1 };
      refunds.push(refund);
      return refund;
    },
  };
  h.stripe = stripe;
  h.protectedStore = refundProtectedOrderStore(rawStore, settlement);
  h.refund = createPaidOrderRefund({ orderStore: rawStore, stripe, settlement, time: { now } });
  h.request = () => h.refund.requestRefund(order.id, { confirmationOrderId: order.id, reason: "Synthetic cancellation" });
  h.delivery = () => ({ readyAt: now().toISOString(), files: [{ token: "dl_synthetic", photoId: "synthetic-photo",
    productId: "jpg-1mp", bucket: "delivery", objectKey: "orders/synthetic.jpg" }], items: [] });
  h.preparing = () => ({ ...order, status: "preparing", paymentIntentId: session.payment_intent,
    amountPaid: 800, paidAt: now().toISOString(), updatedAt: now().toISOString() });
  h.begin = async () => {
    await settlement.beginPaidFulfillment(h.preparing());
    await h.protectedStore.putOrder(h.preparing());
  };
  h.fulfillment = (lifecycleFence = settlement) => createPaidOrderFulfillment({
    orderStore: rawStore, lifecycleFence,
    deliveryRenderer: { createDelivery: async () => h.render ? h.render() : h.delivery() },
    email: { sendReady: async (value) => { emails.push(value.id); return value; } }, analytics: { record: async () => {} },
    time: { now }, downloadPolicy: () => ({}), applyDownloadPolicy: (file) => file,
    mediaIdsForOrder: () => ["synthetic-photo"],
  });
  return h;
}
