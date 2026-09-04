import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  PAID_ORDER_FULFILLMENT_DEPENDENCIES,
  createPaidOrderFulfillment,
} from "./paid-order-fulfillment.mjs";

const fixedNow = () => new Date("2026-09-04T19:00:00.000Z");

const pendingOrder = (overrides = {}) => ({
  id: "PBE-TEST-ORDER",
  status: "pending_payment",
  checkoutMode: "guest",
  checkoutSessionId: "cs_test_paid",
  paymentIntentId: "pi_test_paid",
  buyerEmail: "buyer@example.com",
  currency: "usd",
  amountExpected: 1600,
  amountPaid: 0,
  items: [{ photoId: "001-photo", products: [{ id: "jpg-3mp" }] }],
  createdAt: "2026-09-04T18:59:00.000Z",
  updatedAt: "2026-09-04T18:59:00.000Z",
  ...overrides,
});

const paidSession = (overrides = {}) => ({
  id: "cs_test_paid",
  payment_status: "paid",
  amount_total: 1600,
  currency: "usd",
  payment_intent: "pi_test_paid",
  metadata: { order_id: "PBE-TEST-ORDER" },
  customer_details: { email: "buyer@example.com" },
  ...overrides,
});

const harness = ({ order = pendingOrder(), delivery, lifecycleFence = {} } = {}) => {
  const orders = new Map([[order.id, structuredClone(order)]]);
  const downloads = [];
  const emails = [];
  const analytics = [];
  const orderStore = {
    getOrder: async (id) => structuredClone(orders.get(id) || null),
    putOrder: async (next) => {
      orders.set(next.id, structuredClone(next));
      return next;
    },
    putDownload: async (record) => {
      downloads.push(structuredClone(record));
      return record;
    },
  };
  const deliveryRenderer = delivery || {
    createDelivery: async () => ({
      files: [{
        token: "dl_test",
        bucket: "delivery",
        objectKey: "orders/test.jpg",
        name: "test.jpg",
        contentType: "image/jpeg",
        bytes: 123,
        photoId: "001-photo",
        productId: "jpg-3mp",
      }],
      items: [{ photoId: "001-photo" }],
      readyAt: fixedNow().toISOString(),
    }),
  };
  const fulfillment = createPaidOrderFulfillment({
    orderStore,
    deliveryRenderer,
    lifecycleFence,
    email: {
      sendReady: async (ready) => {
        emails.push(ready.id);
        return ready;
      },
    },
    analytics: { record: async (event) => analytics.push(structuredClone(event)) },
    time: { now: fixedNow },
    downloadPolicy: () => ({ expiresAt: "2026-10-04T19:00:00.000Z", downloadLimit: 100 }),
    applyDownloadPolicy: (file, policy) => ({ ...file, ...policy }),
    mediaIdsForOrder: (target) => target.items.map((item) => item.photoId),
  });
  return { fulfillment, orders, downloads, emails, analytics };
};

test("ready paid-session replay is idempotent", async () => {
  let deliveryCalls = 0;
  const ready = pendingOrder({ status: "ready", amountPaid: 1600, delivery: { files: [] } });
  const { fulfillment, emails, analytics } = harness({
    order: ready,
    delivery: { createDelivery: async () => { deliveryCalls += 1; return {}; } },
  });

  const result = await fulfillment.fulfillPaidSession(paidSession());

  assert.equal(result.status, "ready");
  assert.equal(deliveryCalls, 0);
  assert.deepEqual(emails, [ready.id]);
  assert.equal(analytics.length, 0);
});

test("asynchronous image delivery output becomes a fenced ready capability", async () => {
  let committed = 0;
  let authorized = 0;
  const lifecycleFence = {
    assertAllowed: async () => ({ digest: "fence" }),
    fulfillmentFor: async () => null,
    commitFulfillmentReady: async () => { committed += 1; },
    authorizeDownloadCapability: async () => { authorized += 1; },
  };
  const { fulfillment, orders, downloads, analytics } = harness({ lifecycleFence });

  const result = await fulfillment.fulfillPaidSession(paidSession());

  assert.equal(result.status, "ready");
  assert.equal(result.delivery.files[0].token, "dl_test");
  assert.equal(downloads[0].expiresAt, "2026-10-04T19:00:00.000Z");
  assert.equal(downloads[0].lifecycleSettlementBound, true);
  assert.equal(committed, 1);
  assert.equal(authorized, 1);
  assert.equal(orders.get(result.id).status, "ready");
  assert.equal(analytics[0].event, "payment_completed");
});

test("delivery renderer failure is persisted as delivery_failed", async () => {
  const failure = Object.assign(new Error("Images render failed."), { code: "images_render_failed" });
  const { fulfillment, orders } = harness({
    delivery: { createDelivery: async () => { throw failure; } },
  });

  await assert.rejects(() => fulfillment.fulfillPaidSession(paidSession()), failure);

  const stored = orders.get("PBE-TEST-ORDER");
  assert.equal(stored.status, "delivery_failed");
  assert.equal(stored.deliveryError.code, "images_render_failed");
  assert.equal(stored.amountPaid, 1600);
});

test("lifecycle revocation blocks paid delivery for manual refund review", async () => {
  const revoked = Object.assign(new Error("Asset revoked."), { code: "asset_lifecycle_denied" });
  let deliveryCalls = 0;
  const { fulfillment, orders } = harness({
    lifecycleFence: { assertAllowed: async () => { throw revoked; } },
    delivery: { createDelivery: async () => { deliveryCalls += 1; return {}; } },
  });

  await assert.rejects(
    () => fulfillment.fulfillPaidSession(paidSession()),
    (error) => error.code === "paid_asset_revoked" && error.status === 409,
  );

  assert.equal(deliveryCalls, 0);
  assert.equal(orders.get("PBE-TEST-ORDER").status, "manual_refund_review");
  assert.equal(orders.get("PBE-TEST-ORDER").delivery, null);
});

test("replaying the same paid session recovers delivery_failed to ready without a second charge seam", async () => {
  let deliveryCalls = 0;
  const delivery = {
    createDelivery: async () => {
      deliveryCalls += 1;
      if (deliveryCalls === 1) throw Object.assign(new Error("Temporary render failure."), { code: "temporary_failure" });
      return {
        files: [{ token: "dl_recovered", photoId: "001-photo", productId: "jpg-3mp" }],
        items: [],
      };
    },
  };
  const { fulfillment, orders, analytics } = harness({ delivery });

  await assert.rejects(() => fulfillment.fulfillPaidSession(paidSession()), /Temporary render failure/);
  const recovered = await fulfillment.fulfillPaidSession(paidSession());

  assert.equal(deliveryCalls, 2);
  assert.equal(recovered.status, "ready");
  assert.equal(recovered.amountPaid, 1600);
  assert.equal(recovered.deliveryError, undefined);
  assert.equal(orders.get(recovered.id).status, "ready");
  assert.equal(analytics.filter((event) => event.event === "payment_completed").length, 1);
});

test("revenue module stays within its explicit dependency and transport boundaries", () => {
  assert.deepEqual(PAID_ORDER_FULFILLMENT_DEPENDENCIES, [
    "orderStore",
    "deliveryRenderer",
    "lifecycleFence",
    "email",
    "analytics",
    "time",
    "downloadPolicy",
    "applyDownloadPolicy",
    "mediaIdsForOrder",
  ]);
  const source = fs.readFileSync(new URL("./paid-order-fulfillment.mjs", import.meta.url), "utf8");
  assert.ok(source.split("\n").length <= 300, "revenue module should remain narrowly scoped");
  assert.doesNotMatch(source, /\b(?:Request|Response)\b/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /\/checkout\/|\/stripe-webhook|\/mock-stripe/);
});
