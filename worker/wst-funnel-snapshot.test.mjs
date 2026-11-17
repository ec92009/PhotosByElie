import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { buildWstFunnelSnapshot } from './wst-funnel-snapshot.mjs';
import { funnelFixture, syntheticOrder, syntheticSession, syntheticDelivery, observed, paidAt, readyAt } from './wst-funnel-fixture.mjs';
import { createPaidOrderFulfillment } from './paid-order-fulfillment.mjs';

const row = (day, stage, count = 1, currency = 'USD') => ({ day, stage, provenance: 'unknown', currency, count });
const paid = (id = 'paid', overrides = {}) => syntheticOrder(id, { status: 'preparing', paidAt, amountPaid: 800, paymentIntentId: `pi_${id}`, ...overrides });
const ready = (id = 'ready', overrides = {}) => paid(id, { status: 'ready', lifecycleSettlementBound: true, delivery: syntheticDelivery(), ...overrides });

test('exact aggregate schema uses each evidenced stage timestamp, counts orders once, and exports no identity', async () => {
  const h = funnelFixture([ready(), paid(), syntheticOrder(), paid('eur', { currency: 'eur' })]);
  const snapshot = await buildWstFunnelSnapshot(h);
  assert.deepEqual(snapshot, { schema_version: 'wst.pbe-funnel.v1', site_id: 'photosbyelie', observed_at: observed, days: [
    row('2026-11-14', 'checkout_created', 1, 'EUR'), row('2026-11-14', 'checkout_created', 3),
    row('2026-11-15', 'payment_accepted', 1, 'EUR'), row('2026-11-15', 'payment_accepted', 2), row('2026-11-16', 'delivery_ready'),
  ] });
  assert.doesNotMatch(JSON.stringify(snapshot), /private|cs_live|pi_|photo_id|token|buyer|utm|revenue|download|email/);
  assert.deepEqual(await buildWstFunnelSnapshot(h), snapshot, 'replaying a complete read never accumulates counts');
});

test('deduplicates many delivery files and rejects shared checkout or payment references across orders', async () => {
  const order = ready();
  order.items[0].products.push({ id: 'jpg-3mp' });
  order.delivery.files.push({ ...order.delivery.files[0], token: 'private-second', productId: 'jpg-3mp' });
  const snapshot = await buildWstFunnelSnapshot(funnelFixture([order]));
  assert.equal(snapshot.days.find((row) => row.stage === 'delivery_ready').count, 1);
  const second = paid('second', { checkoutSessionId: order.checkoutSessionId });
  await assert.rejects(buildWstFunnelSnapshot(funnelFixture([order, second])), /duplicate checkout/);
  second.checkoutSessionId = 'cs_live_second'; second.paymentIntentId = order.paymentIntentId;
  await assert.rejects(buildWstFunnelSnapshot(funnelFixture([order, second])), /duplicate payment/);
});

test('unknown provenance remains unknown despite emails, owner flags, coupon labels and provider metadata', async () => {
  const h = funnelFixture([paid('synthetic', { ownerTest: true, provenance: 'external', discountLabel: 'Owner test', buyerEmail: 'owner@example.test' })]);
  h.sessions.get('cs_live_synthetic').metadata.provenance = 'owner_test';
  assert.ok((await buildWstFunnelSnapshot(h)).days.every((row) => row.provenance === 'unknown'));
});

test('missing stages are omitted; native payment_completed, drafts, mock, real-estate and provider test mode are not acceptance', async () => {
  const pending = syntheticOrder('pending', { analytics: [{ event: 'payment_completed' }], amountPaid: 800 });
  const h = funnelFixture([pending, syntheticOrder('draft', { checkoutSessionId: null }),
    syntheticOrder('mock', { checkoutSessionId: 'cs_mock_synthetic' }),
    { id: 'estate', type: 'real_estate_originals', status: 'ready', delivery: { files: [{}] } }, syntheticOrder('test')]);
  h.sessions.get('cs_live_test').livemode = false;
  h.sessions.get('cs_live_pending').payment_status = 'paid'; h.sessions.get('cs_live_pending').status = 'complete';
  assert.deepEqual((await buildWstFunnelSnapshot(h)).days, [row('2026-11-14', 'checkout_created')]);
  assert.equal(h.calls.provider.length, 2);
  assert.deepEqual((await buildWstFunnelSnapshot(funnelFixture([]))).days, []);
});

test('revocations and refunds replace a measured ready cell with zero; lost historical timestamps stay omitted', async () => {
  const h = funnelFixture([ready()]);
  assert.equal((await buildWstFunnelSnapshot(h)).days.at(-1).count, 1);
  for (const code of ['asset_lifecycle_denied', 'lifecycle_fence_changed']) {
    h.lifecycle.assertAllowed = async () => { throw Object.assign(Error('revoked'), { code }); };
    assert.deepEqual((await buildWstFunnelSnapshot(h)).days.at(-1), row('2026-11-16', 'delivery_ready', 0));
  }
  h.lifecycle.fulfillmentFor = async () => ({ orderId: 'ready', state: 'blocked_pending_lifecycle' });
  assert.equal((await buildWstFunnelSnapshot(h)).days.at(-1).count, 0);
  h.records.get('ready').refund = { status: 'pending' };
  assert.equal((await buildWstFunnelSnapshot(h)).days.at(-1).count, 0);
  h.records.get('ready').status = 'manual_refund_review'; h.records.get('ready').delivery = null;
  assert.deepEqual((await buildWstFunnelSnapshot(h)).days, [row('2026-11-14', 'checkout_created'), row('2026-11-15', 'payment_accepted')]);
});

test('provider failures, mismatches and malformed retained evidence reject the entire projection', async () => {
  for (const change of [
    (h) => { h.stripe.retrieveCheckoutSession = async () => { throw Error('provider unavailable'); }; },
    (h) => { h.sessions.delete('cs_live_ready'); },
    (h) => { h.sessions.get('cs_live_ready').amount_total = 801; },
    (h) => { h.sessions.get('cs_live_ready').currency = 'eur'; },
    (h) => { h.sessions.get('cs_live_ready').metadata.order_id = 'wrong'; },
    (h) => { h.sessions.get('cs_live_ready').payment_intent = 'pi_wrong'; },
    (h) => { h.sessions.get('cs_live_ready').created = Number.MAX_VALUE; },
    (h) => { h.sessions.get('cs_live_ready').livemode = null; },
    (h) => { h.sessions.get('cs_live_ready').payment_status = 'unpaid'; },
    (h) => { h.records.get('ready').paidAt = '2026-02-30T10:00:00Z'; },
    (h) => { h.records.get('ready').paidAt = '2026-11-18T10:00:00Z'; },
    (h) => { h.records.get('ready').currency = ''; },
    (h) => { h.records.get('ready').amountPaid = '800'; },
    (h) => { h.records.get('ready').checkoutSessionId = null; },
    (h) => { h.records.get('ready').delivery.readyAt = null; },
    (h) => { h.records.get('ready').delivery = 'malformed'; },
    (h) => { h.records.get('ready').refund = []; },
    (h) => { h.records.get('ready').delivery.readyAt = '2026-11-14T10:00:00Z'; },
    (h) => { h.records.get('ready').delivery.files = []; },
    (h) => { h.records.get('ready').delivery.files.push(h.records.get('ready').delivery.files[0]); },
    (h) => { h.records.get('ready').delivery.files[0].productId = 'wrong'; },
    (h) => { h.lifecycle.fulfillmentFor = async () => null; },
    (h) => { h.lifecycle.fulfillmentFor = async () => ({ orderId: 'wrong', state: 'ready' }); },
    (h) => { h.lifecycle.assertAllowed = async () => null; },
    (h) => { h.lifecycle.assertAllowed = async () => { throw Object.assign(Error('authority unavailable'), { code: 'lifecycle_authority_unavailable' }); }; },
  ]) {
    const h = funnelFixture([syntheticOrder('first'), ready()]); change(h);
    await assert.rejects(buildWstFunnelSnapshot(h), /evidence|unavailable/);
  }
});

test('complete provider reads are bounded and never substitute a partial legacy list', async () => {
  const h = funnelFixture(Array.from({ length: 109 }, (_, i) => syntheticOrder(`s${String(i).padStart(3, '0')}`)));
  let active = 0, peak = 0;
  const read = h.stripe.retrieveCheckoutSession;
  h.stripe.retrieveCheckoutSession = async (id) => {
    active++; peak = Math.max(peak, active); await new Promise(setImmediate);
    try { return await read(id); } finally { active--; }
  };
  h.stripe.listPaymentIntents = () => { assert.fail('no legacy payment list'); };
  assert.deepEqual((await buildWstFunnelSnapshot(h)).days, [row('2026-11-14', 'checkout_created', 109)]);
  assert.equal(peak, 4); assert.equal(active, 0); assert.equal(h.calls.provider.length, 109);
});

test('real fulfillment replay and render failure preserve stage boundaries without a payment or email provider', async () => {
  for (const failRender of [false, true]) {
    const order = syntheticOrder(); const h = funnelFixture([order]);
    const session = syntheticSession(order, { status: 'complete', payment_status: 'paid' });
    h.sessions.set(session.id, session);
    const native = [];
    let clock = paidAt;
    const fulfillment = createPaidOrderFulfillment({
      orderStore: { getOrder: async (id) => structuredClone(h.records.get(id)), putOrder: async (value) => h.records.set(value.id, structuredClone(value)), putDownload: async () => {} },
      deliveryRenderer: { createDelivery: async () => { if (failRender) throw Error('renderer failed'); clock = readyAt; return syntheticDelivery(); } },
      lifecycleFence: { assertAllowed: async () => true }, email: { sendReady: async (value) => value }, analytics: { record: async (value) => native.push(value) },
      time: { now: () => new Date(clock) }, downloadPolicy: () => ({}), applyDownloadPolicy: (file) => file, mediaIdsForOrder: () => ['private-photo'],
    });
    if (failRender) await assert.rejects(fulfillment.fulfillPaidSession(session), /renderer failed/);
    else { await fulfillment.fulfillPaidSession(session); await fulfillment.fulfillPaidSession(session); }
    const rows = (await buildWstFunnelSnapshot(h)).days;
    assert.deepEqual(rows, [row('2026-11-14', 'checkout_created'), row('2026-11-15', 'payment_accepted'), ...(!failRender ? [row('2026-11-16', 'delivery_ready')] : [])]);
    assert.equal(native.length, failRender ? 0 : 1, 'native events neither create nor multiply acceptance');
  }
});

test('RPC is private by binding, checks configuration and leaves existing HTTP and commerce entrypoints intact', async () => {
  const source = fs.readFileSync(new URL('./cloud-worker.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('export default class PhotosByElieWorker extends WorkerEntrypoint');
  const h = funnelFixture([]), env = { ORDERS_KV: h.namespace, ACCESS_DB: {}, STRIPE_SECRET_KEY: 'synthetic', STRIPE_WEBHOOK_SECRET: 'synthetic' };
  const Worker = vm.runInNewContext(source.slice(start).replace('export default class', 'class') + '\nPhotosByElieWorker;', {
    WorkerEntrypoint: class { constructor(value) { this.env = value; } }, worker: { fetch: () => 'unchanged HTTP' },
    handleTilbury: async (request) => new URL(request.url).pathname.startsWith('/tilbury/') ? 'unchanged Tilbury' : null,
    createStripeClient: () => h.stripe, createD1LifecycleDenyStore: ({ database }) => { assert.equal(database, env.ACCESS_DB); return h.lifecycle; },
    buildWstFunnelSnapshot: (options) => buildWstFunnelSnapshot({ ...options, now: h.now }),
  });
  assert.throws(() => new Worker({}).wstFunnelSnapshot(), /Live Stripe is unavailable/);
  assert.equal(await new Worker(env).fetch(new Request('https://example.test/wstFunnelSnapshot')), 'unchanged HTTP');
  assert.equal(await new Worker(env).fetch(new Request('https://example.test/tilbury/catalog')), 'unchanged Tilbury');
  assert.deepEqual((await new Worker(env).wstFunnelSnapshot()).days, []);
  h.namespace.list = async () => { throw Error('private buyer@example.test cs_live_private provider secret'); };
  await assert.rejects(new Worker(env).wstFunnelSnapshot(), { message: 'WST funnel snapshot is unavailable or incomplete.' });
  assert.doesNotMatch(source.slice(0, start), /["']\/wstFunnelSnapshot/);
  await assert.rejects(buildWstFunnelSnapshot({ namespace: h.namespace }), /readers unavailable/);
});
