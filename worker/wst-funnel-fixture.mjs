// Synthetic-only fixtures. No provider network, durable bindings or private source data.
export const observed = '2026-11-17T15:00:00.000Z';
export const createdAt = '2026-11-14T10:00:00.000Z';
export const paidAt = '2026-11-15T11:00:00.000Z';
export const readyAt = '2026-11-16T12:00:00.000Z';
export function syntheticOrder(id = 'synthetic', overrides = {}) {
  return { id, status: 'pending_payment', checkoutSessionId: `cs_live_${id}`, amountExpected: 800, currency: 'usd',
    buyerEmail: 'private@example.test', createdAt,
    items: [{ photoId: 'private-photo', products: [{ id: 'jpg-1mp' }] }], ...overrides };
}
export function syntheticSession(order, overrides = {}) {
  return { id: order.checkoutSessionId, object: 'checkout.session', livemode: true, mode: 'payment',
    status: order.paidAt ? 'complete' : 'open', payment_status: order.paidAt ? 'paid' : 'unpaid',
    created: Date.parse(createdAt) / 1000, currency: order.currency, amount_total: order.amountExpected,
    metadata: { order_id: order.id }, client_reference_id: order.id,
    payment_intent: order.paymentIntentId || `pi_${order.id}`, ...overrides };
}
export function syntheticDelivery() {
  return { readyAt, files: [{ photoId: 'private-photo', productId: 'jpg-1mp', token: 'private-token', bucket: 'delivery', objectKey: 'private/object.jpg' }] };
}
export function funnelFixture(orders = [syntheticOrder()]) {
  const records = new Map(orders.map((order) => [order.id, structuredClone(order)]));
  const sessions = new Map(orders.filter((order) => order.checkoutSessionId).map((order) => [order.checkoutSessionId, syntheticSession(order)]));
  const calls = { list: [], get: [], provider: [], settlement: [], allowed: [] };
  const namespace = {
    async list({ prefix, cursor = '', limit }) {
      calls.list.push({ prefix, cursor, limit });
      const keys = [...records.keys()].map((id) => ({ name: `pbe:orders:${id}` })).sort((a, b) => a.name.localeCompare(b.name));
      const offset = cursor ? Number(cursor) : 0;
      return { keys: keys.slice(offset, offset + limit), list_complete: offset + limit >= keys.length, cursor: String(offset + limit) };
    },
    async get(name, options) { calls.get.push({ name, options }); return JSON.stringify(records.get(name.slice('pbe:orders:'.length))) ?? null; },
    put() { throw Error('snapshot must never write'); },
  };
  const stripe = { async retrieveCheckoutSession(id) { calls.provider.push(id); return structuredClone(sessions.get(id)); } };
  const lifecycle = {
    async ensurePaidSettlementAuthority() {},
    async fulfillmentFor(id) { calls.settlement.push(id); return { orderId: id, state: 'ready', fenceDigest: 'a'.repeat(64) }; },
    async assertAllowed(ids) { calls.allowed.push(ids); return { digest: 'a'.repeat(64), media: ids.map((canonicalMediaId) => ({ canonicalMediaId })) }; },
  };
  return { namespace, stripe, lifecycle, now: () => new Date(observed), records, sessions, calls };
}
