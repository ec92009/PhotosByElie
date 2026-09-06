import assert from "node:assert/strict";
import test from "node:test";
import { buildWstCommerceSnapshot } from "./wst-commerce-snapshot.mjs";

test("WST commerce snapshot exports only verified daily aggregates", async () => {
  const pages = [
    {
      data: [
        { id: "pi_live_ready", status: "succeeded", amount_received: 3200, currency: "usd", created: Date.parse("2026-09-04T20:00:00Z") / 1000 },
        { id: "pi_live_pending", status: "succeeded", amount_received: 800, currency: "usd", created: Date.parse("2026-09-04T21:00:00Z") / 1000 },
        { id: "pi_not_paid", status: "requires_payment_method", amount: 5000, currency: "usd", created: Date.parse("2026-09-04T22:00:00Z") / 1000 },
      ],
      has_more: true,
    },
    {
      data: [{ id: "pi_live_eur", status: "succeeded", amount_received: 1000, currency: "eur", created: Date.parse("2026-09-05T08:00:00Z") / 1000 }],
      has_more: false,
    },
  ];
  const stripe = {
    async listPaymentIntents({ startingAfter }) {
      assert.equal(startingAfter, pages.length === 2 ? "" : "pi_not_paid");
      return pages.shift();
    },
    async listRefunds({ paymentIntentId }) {
      return { data: paymentIntentId === "pi_live_pending" ? [{ status: "succeeded", amount: 300 }] : [] };
    },
  };
  const store = {
    async listOrders() {
      return [
        { paymentIntentId: "pi_live_ready", status: "ready", buyerEmail: "private@example.test", delivery: { readyAt: "2026-09-04T20:01:00Z" } },
        { paymentIntentId: "pi_live_pending", status: "preparing" },
        { paymentIntentId: "pi_mock_old", status: "ready", amountPaid: 999999 },
      ];
    },
  };
  const snapshot = await buildWstCommerceSnapshot({ store, stripe, now: () => new Date("2026-09-06T09:00:00Z") });
  assert.deepEqual(snapshot.days, [
    { day: "2026-09-04", currency: "USD", accepted_conversions: 2, confirmed_revenue: 3700, delivery_ready: 1 },
    { day: "2026-09-05", currency: "EUR", accepted_conversions: 1, confirmed_revenue: 1000, delivery_ready: 0 },
  ]);
  assert.equal(JSON.stringify(snapshot).includes("private@example.test"), false);
  assert.equal(JSON.stringify(snapshot).includes("pi_live"), false);
  assert.equal(JSON.stringify(snapshot).includes("999999"), false);
});
