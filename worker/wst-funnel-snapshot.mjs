import { WST_FUNNEL_LIMITS, boundedMap, evidenceError, identifier, readWstFunnelOrders, record, utcTimestamp } from './wst-funnel-records.mjs';

const deniedCodes = new Set(['asset_lifecycle_denied', 'lifecycle_fence_changed']);
const minorUnits = (value) => Number.isSafeInteger(value) && value >= 0;
const providerId = (value) => typeof value === 'string' ? value : value?.id;

/** Validate the same session/order/amount/currency boundary used by paid fulfillment. */
function checkoutEvidence(order, session, observedAt) {
  if (!record(session) || session.object !== 'checkout.session' || session.id !== order.checkoutSessionId
    || typeof session.livemode !== 'boolean' || session.mode !== 'payment'
    || !['open', 'complete', 'expired'].includes(session.status)
    || !['paid', 'unpaid', 'no_payment_required'].includes(session.payment_status)
    || !identifier(session.metadata?.order_id || session.client_reference_id)
    || (session.metadata?.order_id && session.metadata.order_id !== order.id)
    || (session.client_reference_id && session.client_reference_id !== order.id)
    || !minorUnits(order.amountExpected) || !minorUnits(session.amount_total) || session.amount_total !== order.amountExpected
    || typeof order.currency !== 'string' || !/^[a-zA-Z]{3}$/.test(order.currency)
    || typeof session.currency !== 'string' || session.currency.toLowerCase() !== order.currency.toLowerCase()
    || !Number.isSafeInteger(session.created) || session.created <= 0 || !Number.isSafeInteger(session.created * 1000)) throw evidenceError('checkout validation');
  const created = new Date(session.created * 1000);
  if (!Number.isFinite(created.getTime())) throw evidenceError('checkout timestamp');
  const createdAt = utcTimestamp(created.toISOString(), observedAt);
  const paymentId = providerId(session.payment_intent);
  if (order.paymentIntentId && order.paymentIntentId !== paymentId) throw evidenceError('payment reference mismatch');
  let paidAt = null;
  if (order.paidAt != null && order.paidAt !== '') {
    paidAt = utcTimestamp(order.paidAt, observedAt);
    if (paidAt < createdAt || session.payment_status !== 'paid' || session.status !== 'complete'
      || !identifier(paymentId) || !minorUnits(order.amountPaid) || order.amountPaid !== session.amount_total) throw evidenceError('payment acceptance validation');
  }
  return { createdAt, paidAt, paymentId, currency: order.currency.toUpperCase(), live: session.livemode };
}

function validateSettlement(settlement, order) {
  if (settlement !== null && (!record(settlement) || settlement.orderId !== order.id
    || !['ready', 'manual_refund_review', 'blocked_pending_lifecycle', 'refund_reserved'].includes(settlement.state)
    || (settlement.state === 'ready' && !/^[a-f0-9]{64}$/.test(settlement.fenceDigest)))) throw evidenceError('fulfillment settlement');
  if (order.lifecycleSettlementBound && !settlement) throw evidenceError('fulfillment settlement missing');
}

/** Ready is retained fulfillment, never an assertion about a download or email delivery. */
async function deliveryReady(order, lifecycle, paidAt, observedAt) {
  if (order.delivery != null && !record(order.delivery)) throw evidenceError('delivery record');
  if ((order.refund != null && !record(order.refund)) || (order.deliveryError != null && !record(order.deliveryError))) throw evidenceError('delivery hold record');
  if (!order.delivery?.readyAt) {
    if (order.status === 'ready') throw evidenceError('ready delivery timestamp missing');
    return null;
  }
  const readyAt = utcTimestamp(order.delivery.readyAt, observedAt);
  if (!paidAt || readyAt < paidAt) throw evidenceError('delivery precedes accepted payment');
  if (order.status !== 'ready' || order.refund || order.deliveryError) return { readyAt, count: 0 };
  const items = order.items;
  const files = order.delivery.files;
  if (!Array.isArray(items) || !items.length || items.length > WST_FUNNEL_LIMITS.products
    || !Array.isArray(files) || !files.length || files.length > WST_FUNNEL_LIMITS.products) throw evidenceError('delivery items or files');
  const products = new Set(), tokens = new Set(), mediaIds = new Set();
  for (const item of items) {
    if (!record(item) || !identifier(item.photoId) || !Array.isArray(item.products) || !item.products.length) throw evidenceError('delivery product identity');
    mediaIds.add(item.photoId);
    for (const product of item.products) {
      if (!identifier(product?.id)) throw evidenceError('delivery product identity');
      const key = JSON.stringify([item.photoId, product.id]);
      if (products.has(key) || products.size >= WST_FUNNEL_LIMITS.products) throw evidenceError('duplicate or excessive delivery products');
      products.add(key);
    }
  }
  for (const file of files) {
    const key = JSON.stringify([file?.photoId, file?.productId]);
    if (!record(file) || !identifier(file.token) || !identifier(file.objectKey)
      || !['private', 'delivery'].includes(file.bucket) || tokens.has(file.token) || !products.delete(key)) throw evidenceError('incomplete delivery files');
    tokens.add(file.token);
  }
  if (products.size) throw evidenceError('incomplete delivery files');
  const settlement = await lifecycle.fulfillmentFor(order.id);
  validateSettlement(settlement, order);
  if (settlement && settlement.state !== 'ready') return { readyAt, count: 0 };
  try {
    const fence = await lifecycle.assertAllowed([...mediaIds], 'wst-funnel:delivery-ready');
    if (!record(fence) || !/^[a-f0-9]{64}$/.test(fence.digest) || !Array.isArray(fence.media)
      || fence.media.length !== mediaIds.size
      || new Set(fence.media.map((item) => item?.canonicalMediaId)).size !== mediaIds.size
      || fence.media.some((item) => !mediaIds.has(item?.canonicalMediaId))) throw evidenceError('lifecycle fence');
  } catch (error) {
    if (!deniedCodes.has(error?.code)) throw error;
    return { readyAt, count: 0 };
  }
  const after = await lifecycle.fulfillmentFor(order.id);
  validateSettlement(after, order);
  if (after && after.state !== 'ready') return { readyAt, count: 0 };
  if (settlement?.fenceDigest !== after?.fenceDigest) throw evidenceError('fulfillment settlement changed');
  return { readyAt, count: 1 };
}

/** Complete replacement projection of supported retained Stripe orders, with no private dimensions. */
export async function buildWstFunnelSnapshot({ namespace, prefix = 'pbe', stripe, lifecycle, now = () => new Date() } = {}) {
  if (typeof stripe?.retrieveCheckoutSession !== 'function' || typeof lifecycle?.fulfillmentFor !== 'function'
    || typeof lifecycle?.assertAllowed !== 'function' || typeof lifecycle?.ensurePaidSettlementAuthority !== 'function') throw evidenceError('provider or lifecycle readers unavailable');
  // Observe at read start so a slower old read cannot masquerade as a newer snapshot.
  const observedAt = now().toISOString();
  const observedMs = Date.parse(observedAt);
  utcTimestamp(observedAt, observedMs);
  await lifecycle.ensurePaidSettlementAuthority();
  const orders = await readWstFunnelOrders(namespace, prefix);
  const supported = orders.filter((order) => {
    if (order.type === 'real_estate_originals' || /^cs_mock_/.test(order.checkoutSessionId || '')) return false;
    if (!order.checkoutSessionId) {
      if (order.paidAt || order.paymentIntentId || order.amountPaid > 0 || order.delivery?.readyAt
        || ['preparing', 'ready', 'delivery_failed', 'manual_refund_review'].includes(order.status)) throw evidenceError('checkout reference missing');
      return false; // A local draft is not server checkout creation.
    }
    if (!/^cs_(?:live|test)_[A-Za-z0-9_]+$/.test(order.checkoutSessionId) || typeof order.status !== 'string') throw evidenceError('checkout reference');
    return true;
  });
  const checkoutIds = new Set();
  for (const order of supported) {
    if (checkoutIds.has(order.checkoutSessionId)) throw evidenceError('duplicate checkout reference');
    checkoutIds.add(order.checkoutSessionId);
  }
  const evidence = await boundedMap(supported, async (order) => {
    const session = await stripe.retrieveCheckoutSession(order.checkoutSessionId);
    const checkout = checkoutEvidence(order, session, observedMs);
    if (!checkout.live) return null; // Provider test mode is not proof of an owner test or buyer.
    const delivery = await deliveryReady(order, lifecycle, checkout.paidAt, observedMs);
    return { checkout, delivery };
  });
  const days = new Map(), paymentIds = new Set();
  const add = (timestamp, stage, currency, count = 1) => {
    const day = timestamp.slice(0, 10), provenance = 'unknown'; // No retained, verified provenance authority exists yet.
    const key = `${day}|${stage}|${provenance}|${currency}`;
    const row = days.get(key) || { day, stage, provenance, currency, count: 0 };
    row.count += count;
    if (!Number.isSafeInteger(row.count) || (!days.has(key) && days.size >= WST_FUNNEL_LIMITS.cells)) throw evidenceError('aggregate limit');
    days.set(key, row);
  };
  for (const item of evidence) {
    if (!item) continue;
    const { checkout, delivery } = item;
    if (checkout.paymentId) {
      if (paymentIds.has(checkout.paymentId)) throw evidenceError('duplicate payment reference');
      paymentIds.add(checkout.paymentId);
    }
    add(checkout.createdAt, 'checkout_created', checkout.currency);
    if (checkout.paidAt) add(checkout.paidAt, 'payment_accepted', checkout.currency);
    if (delivery) add(delivery.readyAt, 'delivery_ready', checkout.currency, delivery.count);
  }
  return { schema_version: 'wst.pbe-funnel.v1', site_id: 'photosbyelie', observed_at: observedAt,
    days: [...days.values()].sort((a, b) => a.day.localeCompare(b.day) || a.stage.localeCompare(b.stage) || a.provenance.localeCompare(b.provenance) || a.currency.localeCompare(b.currency)) };
}
