const ELIGIBLE_DELIVERY_STATES = new Set([
  "preparing",
  "delivery_failed",
  "manual_refund_review",
]);

const terminalRefundStatus = (status) => ["succeeded", "failed", "canceled"].includes(String(status || ""));
const refundOrderStatus = (status) => {
  if (status === "succeeded") return "refunded";
  if (status === "failed" || status === "canceled") return "refund_failed";
  return "refund_pending";
};
const refundStatusRank = (status) => ({ pending: 1, requires_action: 1, failed: 2, canceled: 2, partial: 2, succeeded: 3 })[status] || 0;

const paidError = (message, status, code, details) => Object.assign(new Error(message), {
  status,
  code,
  ...(details ? { details } : {}),
});

const requireFunction = (value, label) => {
  if (typeof value !== "function") throw new TypeError(`createPaidOrderRefund requires ${label}.`);
  return value;
};

const cleanReason = (value) => String(value || "").trim().replace(/\s+/g, " ").slice(0, 500);

const entitlementStateFor = (order) => {
  const downloadEvents = Array.isArray(order?.downloadEvents) ? order.downloadEvents : [];
  if (downloadEvents.length) return "used";
  if (order?.delivery?.downloadUrl || order?.delivery?.files?.length) return "issued";
  return "unavailable";
};

const deliveryStateFor = (order) => order?.refund?.deliveryState || order?.status || "unknown";

const publicRefund = (order, { eligible = false, reason = "" } = {}) => ({
  orderId: order.id,
  amount: Number(order.amountPaid || order.amountExpected || 0),
  currency: String(order.currency || "").toLowerCase(),
  paymentStatus: Number(order.amountPaid || 0) > 0 ? "paid" : "unpaid",
  deliveryState: deliveryStateFor(order),
  entitlementState: entitlementStateFor(order),
  refundStatus: order.refund?.status || "none",
  refundId: order.refund?.id || null,
  eligible,
  ineligibleReason: reason || null,
  consequence: eligible
    ? "A full refund will permanently stop delivery and all future download access for this order."
    : "No refund can be started while this order is in its current state.",
  updatedAt: order.refund?.updatedAt || order.updatedAt || null,
  failure: order.refund?.failure ? {
    code: order.refund.failure.code || "refund_failed",
    message: order.refund.failure.message || "Stripe did not complete the refund.",
  } : null,
});

const eligibilityFor = (order) => {
  if (!order) return { eligible: false, reason: "Order was not found." };
  if (!order.checkoutSessionId || !order.paymentIntentId) {
    return { eligible: false, reason: "The paid Stripe session is not recorded on this order." };
  }
  if (Number(order.amountPaid || 0) <= 0) return { eligible: false, reason: "The order is not recorded as paid." };
  const entitlementState = entitlementStateFor(order);
  if (entitlementState === "used") return { eligible: false, reason: "A download entitlement has already been used." };
  if (entitlementState === "issued") return { eligible: false, reason: "Download access has already been issued." };
  if (order.refund?.status === "succeeded") return { eligible: false, reason: "This order is already fully refunded." };
  if (order.refund?.status === "partial") return { eligible: false, reason: "A partial refund already exists; complete it directly in Stripe after manual review." };
  if (order.refund?.status && !terminalRefundStatus(order.refund.status)) {
    return { eligible: false, reason: "A refund is already pending at Stripe." };
  }
  const deliveryState = deliveryStateFor(order);
  if (!ELIGIBLE_DELIVERY_STATES.has(deliveryState)) {
    return { eligible: false, reason: `Delivery state ${deliveryState} is not refundable before download availability.` };
  }
  return { eligible: true, reason: "" };
};

const refundMatchesOrder = (refund, order) => {
  const orderId = String(refund?.metadata?.order_id || "");
  const paymentIntentId = typeof refund?.payment_intent === "string"
    ? refund.payment_intent
    : refund?.payment_intent?.id;
  return (!orderId || orderId === order.id) && paymentIntentId === order.paymentIntentId;
};

export const refundBlocksFulfillment = (order) => {
  const status = String(order?.refund?.status || "");
  return Boolean(status);
};

export const createPaidOrderRefund = ({ orderStore, stripe, time } = {}) => {
  const getOrder = requireFunction(orderStore?.getOrder?.bind(orderStore), "orderStore.getOrder");
  const putOrder = requireFunction(orderStore?.putOrder?.bind(orderStore), "orderStore.putOrder");
  const retrieveCheckoutSession = requireFunction(stripe?.retrieveCheckoutSession?.bind(stripe), "stripe.retrieveCheckoutSession");
  const listRefunds = requireFunction(stripe?.listRefunds?.bind(stripe), "stripe.listRefunds");
  const createRefund = requireFunction(stripe?.createRefund?.bind(stripe), "stripe.createRefund");
  const now = requireFunction(time?.now, "time.now");

  const persistStripeRefund = async (order, refund, fallback = {}) => {
    const updatedAt = now().toISOString();
    const rawStatus = String(refund?.status || fallback.status || "pending");
    const refundAmount = Number(refund?.amount || order.refund?.amount || order.amountPaid || 0);
    const status = rawStatus === "succeeded" && refundAmount !== Number(order.amountPaid)
      ? "partial"
      : rawStatus;
    const incomingAttempt = Number(refund?.metadata?.refund_attempt || fallback.attempt || order.refund?.attempt || 1);
    const existingAttempt = Number(order.refund?.attempt || 0);
    if (order.refund && (
      incomingAttempt < existingAttempt
      || (incomingAttempt === existingAttempt && refundStatusRank(status) < refundStatusRank(order.refund.status))
    )) return order;
    const next = {
      ...order,
      status: refundOrderStatus(status),
      delivery: null,
      refund: {
        ...order.refund,
        id: refund?.id || order.refund?.id || null,
        status,
        amount: refundAmount,
        currency: String(refund?.currency || order.refund?.currency || order.currency || "").toLowerCase(),
        paymentIntentId: order.paymentIntentId,
        deliveryState: order.refund?.deliveryState || fallback.deliveryState || deliveryStateFor(order),
        reason: order.refund?.reason || fallback.reason || "",
        attempt: incomingAttempt,
        idempotencyKey: order.refund?.idempotencyKey || fallback.idempotencyKey || "",
        requestedAt: order.refund?.requestedAt || fallback.requestedAt || updatedAt,
        updatedAt,
        ...(status === "failed" || status === "canceled" ? {
          failure: {
            code: refund?.failure_reason || fallback.failure?.code || "refund_failed",
            message: fallback.failure?.message || "Stripe did not complete the refund.",
          },
        } : { failure: null }),
      },
      updatedAt,
    };
    await putOrder(next);
    return next;
  };

  const reconcile = async (orderId) => {
    let order = await getOrder(orderId);
    if (!order) throw paidError(`No order exists for ${orderId}.`, 404, "unknown_order");
    if (!order.checkoutSessionId || !order.paymentIntentId) return order;
    const session = await retrieveCheckoutSession(order.checkoutSessionId);
    const sessionPaymentIntent = typeof session?.payment_intent === "string"
      ? session.payment_intent
      : session?.payment_intent?.id;
    if (session?.client_reference_id !== order.id || sessionPaymentIntent !== order.paymentIntentId) {
      throw paidError("Stripe session does not match the stored order.", 409, "checkout_session_mismatch");
    }
    if (session.payment_status !== "paid") throw paidError("Stripe session is not paid.", 409, "payment_not_paid");
    if (Number(session.amount_total) !== Number(order.amountPaid)
        || String(session.currency || "").toLowerCase() !== String(order.currency || "").toLowerCase()) {
      throw paidError("Stripe paid amount/currency does not match the order.", 409, "amount_mismatch");
    }
    const listed = await listRefunds({ paymentIntentId: order.paymentIntentId });
    const refunds = Array.isArray(listed) ? listed : listed?.data || [];
    const matching = refunds.filter((refund) => refundMatchesOrder(refund, order));
    if (matching.length) {
      const sorted = matching.sort((left, right) => Number(right.created || 0) - Number(left.created || 0));
      const succeededAmount = sorted
        .filter((refund) => refund.status === "succeeded")
        .reduce((sum, refund) => sum + Number(refund.amount || 0), 0);
      const current = sorted.find((refund) => !terminalRefundStatus(refund.status)) || sorted[0];
      const aggregate = succeededAmount >= Number(order.amountPaid)
        ? { ...current, status: "succeeded", amount: Number(order.amountPaid) }
        : succeededAmount > 0
          ? { ...current, status: "partial", amount: succeededAmount }
          : current;
      order = await persistStripeRefund(order, aggregate);
    }
    return order;
  };

  const preview = async (orderId) => {
    const order = await reconcile(orderId);
    const eligibility = eligibilityFor(order);
    return publicRefund(order, eligibility);
  };

  const requestRefund = async (orderId, payload = {}) => {
    const confirmationOrderId = String(payload.confirmationOrderId || "").trim();
    if (confirmationOrderId !== orderId) {
      throw paidError("Type the exact order id to confirm this refund.", 400, "refund_confirmation_mismatch");
    }
    const reason = cleanReason(payload.reason);
    if (!reason) throw paidError("A support reason is required.", 400, "refund_reason_required");

    let order = await reconcile(orderId);
    const eligibility = eligibilityFor(order);
    if (!eligibility.eligible) throw paidError(eligibility.reason, 409, "refund_not_allowed", publicRefund(order, eligibility));

    const priorAttempt = Number(order.refund?.attempt || 0);
    const attempt = order.refund?.status === "failed" || order.refund?.status === "canceled" ? priorAttempt + 1 : Math.max(1, priorAttempt);
    const requestedAt = now().toISOString();
    const idempotencyKey = `photosbyelie-refund-${order.id}-attempt-${attempt}`;
    const deliveryState = deliveryStateFor(order);
    order = {
      ...order,
      status: "refund_pending",
      delivery: null,
      refund: {
        status: "pending",
        id: null,
        amount: Number(order.amountPaid),
        currency: String(order.currency).toLowerCase(),
        paymentIntentId: order.paymentIntentId,
        deliveryState,
        reason,
        attempt,
        idempotencyKey,
        requestedAt,
        updatedAt: requestedAt,
        failure: null,
      },
      updatedAt: requestedAt,
    };
    await putOrder(order);

    try {
      const refund = await createRefund({
        paymentIntentId: order.paymentIntentId,
        amount: Number(order.amountPaid),
        reason: "requested_by_customer",
        metadata: { order_id: order.id, support_reason: reason, refund_attempt: String(attempt) },
        idempotencyKey,
      });
      order = await persistStripeRefund(order, refund);
      return publicRefund(order, eligibilityFor(order));
    } catch (error) {
      const listed = await listRefunds({ paymentIntentId: order.paymentIntentId }).catch(() => []);
      const refunds = Array.isArray(listed) ? listed : listed?.data || [];
      const matching = refunds.filter((refund) => refundMatchesOrder(refund, order));
      if (matching.length) {
        order = await persistStripeRefund(order, matching[0]);
        return publicRefund(order, eligibilityFor(order));
      }
      order = await persistStripeRefund(order, null, {
        status: "failed",
        deliveryState,
        reason,
        attempt,
        idempotencyKey,
        requestedAt,
        failure: {
          code: error?.code || "stripe_refund_failed",
          message: error?.message || "Stripe did not accept the refund request.",
        },
      });
      throw paidError(order.refund.failure.message, 502, "stripe_refund_failed", publicRefund(order, eligibilityFor(order)));
    }
  };

  const applyRefundEvent = async (refund) => {
    const orderId = String(refund?.metadata?.order_id || "").trim();
    if (!orderId) return null;
    const order = await getOrder(orderId);
    if (!order || !refundMatchesOrder(refund, order)) {
      throw paidError("Stripe refund does not match the stored order.", 409, "refund_order_mismatch");
    }
    if (Number(refund.amount) !== Number(order.amountPaid)
        || String(refund.currency || "").toLowerCase() !== String(order.currency || "").toLowerCase()) {
      throw paidError("Stripe refund amount/currency does not match the order.", 409, "refund_amount_mismatch");
    }
    return persistStripeRefund(order, refund);
  };

  return { preview, requestRefund, reconcile, applyRefundEvent };
};
