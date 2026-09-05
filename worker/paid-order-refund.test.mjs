import assert from "node:assert/strict";
import test from "node:test";

import { createPaidOrderRefund } from "./paid-order-refund.mjs";

const fixedNow = () => new Date("2026-09-04T20:00:00.000Z");

const paidOrder = (overrides = {}) => ({
  id: "PBE-20260904-REFUND",
  status: "delivery_failed",
  checkoutSessionId: "cs_refund",
  paymentIntentId: "pi_refund",
  amountExpected: 1600,
  amountPaid: 1600,
  currency: "usd",
  delivery: null,
  createdAt: "2026-09-04T19:00:00.000Z",
  updatedAt: "2026-09-04T19:01:00.000Z",
  ...overrides,
});

const harness = ({ order = paidOrder(), refundStatus = "succeeded", createFailure = null } = {}) => {
  const orders = new Map([[order.id, structuredClone(order)]]);
  const refunds = [];
  const createCalls = [];
  const stripe = {
    retrieveCheckoutSession: async () => ({
      id: "cs_refund",
      client_reference_id: order.id,
      payment_status: "paid",
      amount_total: 1600,
      currency: "usd",
      payment_intent: "pi_refund",
    }),
    listRefunds: async () => ({ data: refunds.map((refund) => structuredClone(refund)) }),
    createRefund: async (request) => {
      createCalls.push(structuredClone(request));
      if (createFailure) throw createFailure;
      const refund = {
        id: "re_refund",
        payment_intent: "pi_refund",
        amount: 1600,
        currency: "usd",
        status: refundStatus,
        metadata: { order_id: order.id },
        created: 1,
      };
      refunds.push(refund);
      return structuredClone(refund);
    },
  };
  const orderStore = {
    getOrder: async (id) => structuredClone(orders.get(id) || null),
    putOrder: async (next) => {
      orders.set(next.id, structuredClone(next));
      return next;
    },
  };
  return {
    refund: createPaidOrderRefund({ orderStore, stripe, time: { now: fixedNow } }),
    orders,
    refunds,
    createCalls,
  };
};

test("preview reconciles Stripe and allows only paid pre-delivery orders", async () => {
  const { refund } = harness();
  const preview = await refund.preview("PBE-20260904-REFUND");
  assert.equal(preview.eligible, true);
  assert.equal(preview.amount, 1600);
  assert.equal(preview.deliveryState, "delivery_failed");
  assert.equal(preview.entitlementState, "unavailable");
});

test("explicit confirmation persists a full Stripe refund and permanent delivery block", async () => {
  const { refund, orders, createCalls } = harness();
  const result = await refund.requestRefund("PBE-20260904-REFUND", {
    confirmationOrderId: "PBE-20260904-REFUND",
    reason: "Buyer requested cancellation before delivery.",
  });
  assert.equal(result.refundStatus, "succeeded");
  assert.equal(result.eligible, false);
  assert.equal(orders.get(result.orderId).status, "refunded");
  assert.equal(orders.get(result.orderId).delivery, null);
  assert.equal(createCalls[0].idempotencyKey, "photosbyelie-refund-PBE-20260904-REFUND-attempt-1");
  assert.equal(createCalls[0].reason, "requested_by_customer");
});

test("issued and used download entitlements independently fail closed", async () => {
  const issued = harness({ order: paidOrder({ status: "ready", delivery: { downloadUrl: "/download/token" } }) });
  assert.equal((await issued.refund.preview("PBE-20260904-REFUND")).ineligibleReason, "Download access has already been issued.");

  const used = harness({ order: paidOrder({ downloadEvents: [{ token: "token" }] }) });
  assert.equal((await used.refund.preview("PBE-20260904-REFUND")).ineligibleReason, "A download entitlement has already been used.");
});

test("failed attempts remain visible and retry with a new attempt-stable idempotency key", async () => {
  const failed = paidOrder({
    status: "refund_failed",
    refund: {
      status: "failed",
      attempt: 1,
      deliveryState: "delivery_failed",
      amount: 1600,
      currency: "usd",
      paymentIntentId: "pi_refund",
    },
  });
  const { refund, createCalls } = harness({ order: failed });
  const result = await refund.requestRefund(failed.id, {
    confirmationOrderId: failed.id,
    reason: "Retry after confirmed provider failure.",
  });
  assert.equal(result.refundStatus, "succeeded");
  assert.equal(createCalls[0].idempotencyKey, "photosbyelie-refund-PBE-20260904-REFUND-attempt-2");
});

test("out-of-order succeeded webhook is monotonic and blocks duplicate refund creation", async () => {
  const pending = paidOrder({
    status: "refund_pending",
    refund: {
      status: "pending",
      attempt: 1,
      deliveryState: "preparing",
      amount: 1600,
      currency: "usd",
      paymentIntentId: "pi_refund",
    },
  });
  const { refund, orders, createCalls } = harness({ order: pending });
  await refund.applyRefundEvent({
    id: "re_late_success",
    payment_intent: "pi_refund",
    amount: 1600,
    currency: "usd",
    status: "succeeded",
    metadata: { order_id: pending.id, refund_attempt: "1" },
  });
  assert.equal(orders.get(pending.id).status, "refunded");
  await refund.applyRefundEvent({
    id: "re_late_success",
    payment_intent: "pi_refund",
    amount: 1600,
    currency: "usd",
    status: "pending",
    metadata: { order_id: pending.id, refund_attempt: "1" },
  });
  assert.equal(orders.get(pending.id).status, "refunded");
  await assert.rejects(
    () => refund.requestRefund(pending.id, { confirmationOrderId: pending.id, reason: "Duplicate" }),
    (error) => error.code === "refund_not_allowed",
  );
  assert.equal(createCalls.length, 0);
});

test("partial Stripe refunds are surfaced for manual completion instead of over-refunding", async () => {
  const { refund, refunds } = harness();
  refunds.push({
    id: "re_partial",
    payment_intent: "pi_refund",
    amount: 400,
    currency: "usd",
    status: "succeeded",
    metadata: {},
    created: 1,
  });
  const preview = await refund.preview("PBE-20260904-REFUND");
  assert.equal(preview.refundStatus, "partial");
  assert.match(preview.ineligibleReason, /partial refund/i);
});
