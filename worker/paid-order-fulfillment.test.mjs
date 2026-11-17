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

const harness = ({ order = pendingOrder(), delivery, lifecycleFence = {}, onPutOrder, onPutDownload, onEmail } = {}) => {
  const orders = new Map([[order.id, structuredClone(order)]]);
  const writes = [];
  const downloads = [];
  const emails = [];
  const analytics = [];
  const orderStore = {
    getOrder: async (id) => structuredClone(orders.get(id) || null),
    putOrder: async (next) => {
      writes.push(structuredClone(next));
      orders.set(next.id, structuredClone(next));
      await onPutOrder?.(next);
      return next;
    },
    putDownload: async (record) => {
      downloads.push(structuredClone(record));
      await onPutDownload?.(record);
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
  const dependencies = {
    allowUnsettledMock: true, // Isolated unit seam; authority races use real D1 in paid-refund-race.test.mjs.
    orderStore,
    deliveryRenderer,
    lifecycleFence,
    email: {
      sendReady: async (ready) => {
        emails.push(ready.id);
        await onEmail?.(ready);
        return ready;
      },
    },
    analytics: { record: async (event) => analytics.push(structuredClone(event)) },
    time: { now: fixedNow },
    downloadPolicy: () => ({ expiresAt: "2026-10-04T19:00:00.000Z", downloadLimit: 100 }),
    applyDownloadPolicy: (file, policy) => ({ ...file, ...policy }),
    mediaIdsForOrder: (target) => target.items.map((item) => item.photoId),
  };
  const fulfillment = createPaidOrderFulfillment(dependencies);
  return { fulfillment, dependencies, orders, writes, downloads, emails, analytics };
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

test("invalid paid-session identity, status, amount and currency have no fulfillment side effects", async (t) => {
  const cases = [
    [{ metadata: {} }, "missing_order_id", 400],
    [{ metadata: { order_id: "other-order" } }, "unknown_order", 404],
    [{ id: "other-session" }, "checkout_session_mismatch", 409],
    [{ payment_status: "unpaid" }, "payment_not_paid", 409],
    [{ amount_total: 1599 }, "amount_mismatch", 409],
    [{ amount_total: "not-a-number" }, "amount_mismatch", 409],
    [{ currency: "eur" }, "amount_mismatch", 409],
  ];
  for (const [overrides, code, status] of cases) {
    await t.test(code + ": " + JSON.stringify(overrides), async () => {
      const h = harness({
        delivery: { createDelivery: async () => assert.fail("invalid session must not render") },
        lifecycleFence: { fulfillmentFor: async () => assert.fail("invalid session must not reach settlement") },
      });
      await assert.rejects(h.fulfillment.fulfillPaidSession(paidSession(overrides)), { code, status });
      assert.deepEqual(h.orders.get("PBE-TEST-ORDER"), pendingOrder());
      for (const records of [h.writes, h.downloads, h.emails, h.analytics]) assert.deepEqual(records, []);
    });
  }
});

test("ready replay still validates the paid amount before the email handoff", async () => {
  const h = harness({ order: pendingOrder({ status: "ready" }) });
  await assert.rejects(h.fulfillment.fulfillPaidSession(paidSession({ amount_total: 9999 })), { code: "amount_mismatch" });
  assert.deepEqual(h.emails, []);
  assert.deepEqual(h.writes, []);
});

test("client-reference fallback and uppercase Stripe currency preserve the stored buyer when email is absent", async () => {
  const h = harness();
  const ready = await h.fulfillment.fulfillPaidSession(paidSession({
    metadata: {}, client_reference_id: "PBE-TEST-ORDER", currency: "USD", customer_details: {},
  }));
  assert.equal(ready.status, "ready");
  assert.equal(ready.buyerEmail, "buyer@example.com");
  assert.equal(ready.amountPaid, 1600);
});

test("settlement holds and unavailable authority stop pending and ready replays without writes", async (t) => {
  for (const orderStatus of ["pending_payment", "ready"]) {
    for (const unavailable of [false, true]) {
      await t.test(`${orderStatus}, unavailable=${unavailable}`, async () => {
        const order = pendingOrder({ status: orderStatus });
        const h = harness({
          order,
          delivery: { createDelivery: async () => assert.fail("held order must not render") },
          lifecycleFence: { fulfillmentFor: async () => {
            if (unavailable) throw Object.assign(new Error("Authority unavailable"), { status: 503, code: "lifecycle_authority_unavailable" });
            return { state: "blocked_pending_lifecycle", lifecycleOperationId: "op-held" };
          } },
        });
        await assert.rejects(h.fulfillment.fulfillPaidSession(paidSession()), {
          code: unavailable ? "lifecycle_authority_unavailable" : "paid_asset_lifecycle_pending",
          status: unavailable ? 503 : 409,
        });
        assert.deepEqual(h.orders.get(order.id), order);
        for (const records of [h.writes, h.downloads, h.emails, h.analytics]) assert.deepEqual(records, []);
      });
    }
  }
});

test("authoritative refund review repairs a stale ready projection and remains idempotent", async () => {
  const h = harness({
    order: pendingOrder({ status: "ready", delivery: { files: [{ token: "old-token" }] } }),
    lifecycleFence: { fulfillmentFor: async () => ({ state: "manual_refund_review", lifecycleOperationId: "op-revoked" }) },
  });
  for (let replay = 0; replay < 2; replay += 1) {
    await assert.rejects(h.fulfillment.fulfillPaidSession(paidSession()), { code: "paid_asset_revoked", status: 409 });
  }
  const blocked = h.orders.get("PBE-TEST-ORDER");
  assert.equal(blocked.status, "manual_refund_review");
  assert.equal(blocked.delivery, null);
  assert.equal(h.writes.length, 1);
  assert.deepEqual(h.downloads, []);
  assert.deepEqual(h.emails, []);
  assert.deepEqual(h.analytics, []);
});

test("render and commit fence changes cannot mint capabilities or notify the buyer", async (t) => {
  for (const phase of ["fulfillment:after-render", "fulfillment:before-ready-commit", "commit"]) {
    await t.test(phase, async () => {
      const fence = { digest: "original-fence" };
      const changed = () => { throw Object.assign(new Error("Lifecycle revision changed"), { code: "lifecycle_fence_changed" }); };
      const h = harness({ lifecycleFence: {
        assertAllowed: async (ids, context, expectedFence) => {
          assert.deepEqual(ids, ["001-photo"]);
          if (context !== "fulfillment:before-prepare") assert.equal(expectedFence, fence);
          if (context === phase) changed();
          return fence;
        },
        commitFulfillmentReady: async ({ mediaIds, fence: committedFence }) => {
          assert.deepEqual(mediaIds, ["001-photo"]);
          assert.equal(committedFence, fence);
          if (phase === "commit") changed();
          else assert.fail("revocation must precede commit");
        },
      } });
      await assert.rejects(h.fulfillment.fulfillPaidSession(paidSession()), { code: "paid_asset_revoked", status: 409 });
      assert.equal(h.orders.get("PBE-TEST-ORDER").status, "manual_refund_review");
      assert.equal(h.orders.get("PBE-TEST-ORDER").delivery, null);
      assert.deepEqual(h.downloads, []);
      assert.deepEqual(h.emails, []);
      assert.deepEqual(h.analytics, []);
    });
  }
});

test("a deny armed during the ready projection preserves the hold without capabilities", async () => {
  let state = null;
  const h = harness({
    lifecycleFence: {
      assertAllowed: async () => ({ digest: "fence" }),
      commitFulfillmentReady: async () => { state = "ready"; },
      fulfillmentFor: async () => state && ({ state }),
      authorizeDownloadCapability: async () => assert.fail("held settlement must not authorize"),
    },
    onPutOrder: async (order) => {
      if (order.lifecycleSettlementBound) state = "blocked_pending_lifecycle";
    },
  });
  await assert.rejects(h.fulfillment.fulfillPaidSession(paidSession()), { code: "paid_asset_lifecycle_pending" });
  const held = h.orders.get("PBE-TEST-ORDER");
  assert.equal(held.status, "preparing");
  assert.equal(held.delivery, null);
  assert.deepEqual(h.downloads, []);
  assert.deepEqual(h.emails, []);
});

test("revocation between per-file writes stops later capabilities and buyer notification", async () => {
  let state = null;
  const authorized = [];
  const h = harness({
    delivery: { createDelivery: async () => ({ files: ["first", "second"].map((token) => ({ token, photoId: "001-photo" })) }) },
    lifecycleFence: {
      assertAllowed: async () => ({ digest: "fence" }),
      commitFulfillmentReady: async () => { state = "ready"; },
      fulfillmentFor: async () => state && ({ state }),
      authorizeDownloadCapability: async ({ token }) => authorized.push(token),
    },
    onPutDownload: async () => { state = "manual_refund_review"; },
  });
  await assert.rejects(h.fulfillment.fulfillPaidSession(paidSession()), { code: "paid_asset_revoked" });
  assert.deepEqual(authorized, ["first"]);
  assert.deepEqual(h.downloads.map((record) => record.token), ["first"]);
  assert.equal(h.orders.get("PBE-TEST-ORDER").status, "manual_refund_review");
  assert.equal(h.orders.get("PBE-TEST-ORDER").delivery, null);
  assert.deepEqual(h.emails, []);
  assert.deepEqual(h.analytics, []);
});

test("post-email settlement revocation cannot return ready or record payment-completed analytics", async () => {
  let state = null;
  const h = harness({
    lifecycleFence: {
      assertAllowed: async () => ({ digest: "fence" }),
      commitFulfillmentReady: async () => { state = "ready"; },
      fulfillmentFor: async () => state && ({ state }),
      authorizeDownloadCapability: async () => {},
    },
    onEmail: async () => { state = "manual_refund_review"; },
  });
  await assert.rejects(h.fulfillment.fulfillPaidSession(paidSession()), { code: "paid_asset_revoked" });
  assert.equal(h.emails.length, 1, "an already-claimed provider handoff cannot be recalled");
  assert.equal(h.orders.get("PBE-TEST-ORDER").status, "manual_refund_review");
  assert.deepEqual(h.analytics, []);
});

test("legacy archive capabilities keep the same canonical media and download policy", async () => {
  const h = harness({ delivery: { createDelivery: async () => ({
    token: "archive-token", zipKey: "private/order.zip", downloadUrl: "/download/archive-token", items: [],
  }) } });
  const ready = await h.fulfillment.fulfillPaidSession(paidSession());
  assert.equal(ready.delivery.downloadUrl, "/download/archive-token");
  assert.equal(h.downloads.length, 1);
  assert.deepEqual(h.downloads[0].canonicalMediaIds, ["001-photo"]);
  assert.equal(h.downloads[0].expiresAt, "2026-10-04T19:00:00.000Z");
  assert.equal(h.downloads[0].downloadLimit, 100);
});

test("missing mandatory dependencies fail at construction before processing payments", () => {
  const { dependencies } = harness();
  const required = [
    ["orderStore", "getOrder"], ["orderStore", "putOrder"], ["orderStore", "putDownload"],
    ["deliveryRenderer", "createDelivery"], ["email", "sendReady"], ["analytics", "record"], ["time", "now"],
    ["downloadPolicy"], ["applyDownloadPolicy"], ["mediaIdsForOrder"],
  ];
  for (const [name, method] of required) {
    const incomplete = { ...dependencies, [name]: method ? { ...dependencies[name], [method]: null } : null };
    assert.throws(() => createPaidOrderFulfillment(incomplete), {
      name: "TypeError", message: `createPaidOrderFulfillment requires ${name}${method ? "." + method : ""}.`,
    });
  }
});

test("a refund started during rendering prevents download capability publication", async () => {
  let releaseDelivery;
  const deliveryReady = new Promise((resolve) => { releaseDelivery = resolve; });
  const { fulfillment, orders, downloads } = harness({
    delivery: {
      createDelivery: async () => {
        await deliveryReady;
        return {
          files: [{ token: "dl_must_not_publish", photoId: "001-photo", productId: "jpg-3mp" }],
          items: [],
        };
      },
    },
  });
  const inFlight = fulfillment.fulfillPaidSession(paidSession());
  await new Promise((resolve) => setImmediate(resolve));
  const preparing = orders.get("PBE-TEST-ORDER");
  orders.set(preparing.id, {
    ...preparing,
    status: "refund_pending",
    refund: { status: "pending", deliveryState: "preparing" },
  });
  releaseDelivery();

  await assert.rejects(
    () => inFlight,
    (error) => error.code === "refund_blocks_fulfillment" && error.status === 409,
  );
  assert.equal(downloads.length, 0);
  assert.equal(orders.get("PBE-TEST-ORDER").status, "refund_pending");
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
