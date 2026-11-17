const stripeId = (prefix, randomUUID) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 24)}`;

export const createMockStripeClient = ({
  webhookSecret = "mock_whsec_photosbyelie",
  checkoutBaseUrl = "https://mock.stripe.local/checkout",
  randomUUID = () => crypto.randomUUID(),
} = {}) => {
  const sessions = new Map();
  const refunds = new Map();
  const refundIdempotency = new Map();

  const createCheckoutSession = async ({
    orderId,
    buyerEmail,
    amountTotal,
    currency,
    lineItems,
    successUrl,
    cancelUrl,
    receiptDescription,
    metadata = {},
  }) => {
    const id = stripeId("cs_mock", randomUUID);
    const paymentIntent = stripeId("pi_mock", randomUUID);
    const sessionMetadata = { order_id: orderId, ...metadata };
    const session = {
      id,
      object: "checkout.session",
      client_reference_id: orderId,
      metadata: sessionMetadata,
      mode: "payment",
      payment_status: "unpaid",
      amount_total: amountTotal,
      currency,
      customer_details: { email: buyerEmail },
      payment_intent: paymentIntent,
      line_items: lineItems,
      success_url: successUrl,
      cancel_url: cancelUrl,
      payment_intent_data: {
        description: receiptDescription,
        metadata: sessionMetadata,
      },
      url: `${checkoutBaseUrl}/${id}`,
    };
    sessions.set(id, session);
    return { ...session };
  };

  const paidEventForSession = (checkoutSessionId, overrides = {}) => {
    const session = sessions.get(checkoutSessionId);
    if (!session) throw new Error(`Unknown mock Checkout Session: ${checkoutSessionId}`);
    const paidSession = {
      ...session,
      ...overrides,
      payment_status: overrides.payment_status || "paid",
    };
    sessions.set(checkoutSessionId, paidSession);
    return {
      id: stripeId("evt_mock", randomUUID),
      object: "event",
      type: "checkout.session.completed",
      created: Math.floor(Date.now() / 1000),
      data: { object: paidSession },
    };
  };

  const retrieveCheckoutSession = async (sessionId) => {
    const session = sessions.get(sessionId);
    if (!session) throw Object.assign(new Error("Stripe Checkout Session was not found."), { code: "stripe_session_not_found" });
    return { ...session };
  };

  const listRefunds = async ({ paymentIntentId }) => ({
    object: "list",
    data: [...refunds.values()].filter((refund) => refund.payment_intent === paymentIntentId).map((refund) => ({ ...refund })),
  });

  const createRefund = async ({ paymentIntentId, amount, reason, metadata = {}, idempotencyKey }) => {
    if (refundIdempotency.has(idempotencyKey)) return { ...refundIdempotency.get(idempotencyKey) };
    const id = stripeId("re_mock", randomUUID);
    const refund = {
      id,
      object: "refund",
      payment_intent: paymentIntentId,
      amount,
      currency: [...sessions.values()].find((session) => session.payment_intent === paymentIntentId)?.currency || "usd",
      reason,
      metadata: { ...metadata },
      status: "succeeded",
      created: Math.floor(Date.now() / 1000),
    };
    refunds.set(id, refund);
    refundIdempotency.set(idempotencyKey, refund);
    return { ...refund };
  };

  const signatureForPayload = () => `mock=${webhookSecret}`;

  const constructEvent = async (request) => {
    const signature = request.headers.get("stripe-signature") || request.headers.get("x-mock-stripe-signature");
    if (webhookSecret && signature !== signatureForPayload()) {
      throw new Error("Invalid mock Stripe signature.");
    }
    return request.json();
  };

  return {
    provider: "mock-stripe",
    createCheckoutSession,
    retrieveCheckoutSession,
    listRefunds,
    createRefund,
    paidEventForSession,
    signatureForPayload,
    constructEvent,
    _debug: { sessions, refunds, refundIdempotency },
  };
};
