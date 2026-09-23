const MAX_PAYMENT_PAGES = 100;

const safeMinorUnits = (value) => {
  const amount = Number(value || 0);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : 0;
};

const paymentDay = (paymentIntent) => {
  const seconds = Number(paymentIntent?.created || 0);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return "";
  return new Date(seconds * 1000).toISOString().slice(0, 10);
};

async function listSucceededPaymentIntents(stripe) {
  const results = [];
  let startingAfter = "";
  for (let page = 0; page < MAX_PAYMENT_PAGES; page += 1) {
    const response = await stripe.listPaymentIntents({ startingAfter, limit: 100 });
    const rows = Array.isArray(response?.data) ? response.data : [];
    results.push(...rows.filter((row) => row?.status === "succeeded"));
    if (!response?.has_more) return results;
    const lastId = rows.at(-1)?.id;
    if (!lastId || lastId === startingAfter) throw new Error("Stripe payment pagination did not advance.");
    startingAfter = lastId;
  }
  throw new Error("Stripe payment pagination exceeded the safety limit.");
}

async function netRevenue(stripe, paymentIntent) {
  const refunds = await stripe.listRefunds({ paymentIntentId: paymentIntent.id });
  const refunded = (Array.isArray(refunds?.data) ? refunds.data : [])
    .filter((refund) => refund?.status === "succeeded")
    .reduce((sum, refund) => sum + safeMinorUnits(refund.amount), 0);
  return Math.max(0, safeMinorUnits(paymentIntent.amount_received ?? paymentIntent.amount) - refunded);
}

/**
 * Build the only commerce payload WST may read from PBE. It contains UTC daily
 * totals and delivery-state counts, never Stripe, order, customer, or asset IDs.
 */
export async function buildWstCommerceSnapshot({ store, stripe, now = () => new Date() } = {}) {
  if (!store?.listOrders || !stripe?.listPaymentIntents || !stripe?.listRefunds) {
    throw new Error("WST commerce snapshot requires PBE order and Stripe readers.");
  }
  const [orders, payments] = await Promise.all([store.listOrders(), listSucceededPaymentIntents(stripe)]);
  const orderByPaymentIntent = new Map(orders
    .filter((order) => typeof order?.paymentIntentId === "string" && order.paymentIntentId)
    .map((order) => [order.paymentIntentId, order]));
  const days = new Map();

  for (const payment of payments) {
    const day = paymentDay(payment);
    const currency = String(payment.currency || "").toUpperCase();
    if (!day || !/^[A-Z]{3}$/.test(currency) || !payment.id) continue;
    const key = `${day}|${currency}`;
    const row = days.get(key) || {
      day,
      currency,
      accepted_conversions: 0,
      confirmed_revenue: 0,
      delivery_ready: 0,
    };
    row.accepted_conversions += 1;
    row.confirmed_revenue += await netRevenue(stripe, payment);
    const order = orderByPaymentIntent.get(payment.id);
    if (order?.status === "ready" && (order.delivery?.readyAt || order.delivery?.downloadUrl || order.delivery?.files?.length)) {
      row.delivery_ready += 1;
    }
    days.set(key, row);
  }

  return {
    schema_version: "wst.pbe-commerce.v1",
    site_id: "photosbyelie",
    observed_at: now().toISOString(),
    days: [...days.values()].sort((left, right) => left.day.localeCompare(right.day) || left.currency.localeCompare(right.currency)),
  };
}
