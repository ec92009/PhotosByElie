const stripeId = (prefix, randomUUID) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 24)}`;

export const createMockStripeClient = ({
  webhookSecret = "mock_whsec_photosbyelie",
  checkoutBaseUrl = "https://mock.stripe.local/checkout",
  randomUUID = () => crypto.randomUUID(),
} = {}) => {
  const sessions = new Map();

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
    return {
      id: stripeId("evt_mock", randomUUID),
      object: "event",
      type: "checkout.session.completed",
      created: Math.floor(Date.now() / 1000),
      data: { object: paidSession },
    };
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
    paidEventForSession,
    signatureForPayload,
    constructEvent,
    _debug: { sessions },
  };
};
