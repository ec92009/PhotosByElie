import assert from 'node:assert/strict';
import test from 'node:test';
import { boundedMap, readWstFunnelOrders, WST_FUNNEL_LIMITS } from './wst-funnel-records.mjs';
import { funnelFixture, syntheticOrder } from './wst-funnel-fixture.mjs';

test('complete order reads paginate and bound concurrent value reads', async () => {
  const orders = Array.from({ length: 205 }, (_, i) => syntheticOrder(`s${String(i).padStart(4, '0')}`));
  const h = funnelFixture(orders);
  const get = h.namespace.get;
  let active = 0, peak = 0;
  h.namespace.get = async (...args) => {
    active++; peak = Math.max(peak, active);
    await new Promise(setImmediate);
    try { return await get(...args); } finally { active--; }
  };
  assert.deepEqual(await readWstFunnelOrders(h.namespace), orders);
  assert.deepEqual(h.calls.list.map((call) => call.cursor), ['', '100', '200']);
  assert.equal(h.calls.get.length, 205);
  assert.equal(peak, WST_FUNNEL_LIMITS.concurrency);
});

test('a fixed pool drains failures, stops scheduling, and preserves input order', async () => {
  let called = 0, active = 0;
  await assert.rejects(boundedMap(Array.from({ length: 25 }, (_, i) => i), async (i) => {
    called++; active++;
    try { await new Promise(setImmediate); if (i === 0) throw Error('read failure'); return i; } finally { active--; }
  }), /read failure/);
  assert.equal(called, 4); assert.equal(active, 0);
  assert.deepEqual(await boundedMap([3, 2, 1], async (value) => value * 2), [6, 4, 2]);
  for (const failure of [null, undefined, false, 0]) {
    let rejected = false;
    try { await boundedMap([1], async () => { throw failure; }); } catch { rejected = true; }
    assert.equal(rejected, true, 'even a falsy provider rejection is a failed read');
  }
});

test('missing readers, malformed pages, keys and incomplete paging always fail', async () => {
  await assert.rejects(readWstFunnelOrders({}), /readers unavailable/);
  for (const page of [null, {}, { keys: [], list_complete: 'true' }, { objects: [], list_complete: true },
    { keys: [], list_complete: false }, { keys: [], list_complete: false, cursor: '' },
    { keys: [], list_complete: true, truncated: true },
    { keys: [{ name: 'pbe:orders:' }], list_complete: true },
    { keys: [{ name: 'private:orders:synthetic' }], list_complete: true },
    { keys: [{ name: 'pbe:orders:synthetic' }, { name: 'pbe:orders:synthetic' }], list_complete: true },
    { keys: Array(101).fill({ name: 'pbe:orders:synthetic' }), list_complete: true },
  ]) {
    const h = funnelFixture(); h.namespace.list = async () => page;
    await assert.rejects(readWstFunnelOrders(h.namespace), /evidence/);
  }
  for (const cursorFor of [() => 'stuck', (i) => ['one', 'two'][i % 2], (i) => `advances_${i}`]) {
    const h = funnelFixture(); let pages = 0;
    h.namespace.list = async () => ({ keys: [], list_complete: false, cursor: cursorFor(pages++) });
    await assert.rejects(readWstFunnelOrders(h.namespace), /cursor|page limit/);
    assert.ok(pages <= WST_FUNNEL_LIMITS.pages);
  }
  const h = funnelFixture();
  h.namespace.list = async () => ({ keys: [{ name: 'pbe:orders:synthetic' }], list_complete: false, cursor: 'next' });
  await assert.rejects(readWstFunnelOrders(h.namespace), /nonadvancing order keys/);
});

test('missing, invalid, oversized, identity-mismatched and interrupted values are not empty success', async () => {
  for (const value of [null, '', '[]', '{}', '{', 'null', JSON.stringify({ id: 'another' }), 'x'.repeat(WST_FUNNEL_LIMITS.recordBytes + 1)]) {
    const h = funnelFixture(); h.namespace.get = async () => value;
    await assert.rejects(readWstFunnelOrders(h.namespace), /evidence/);
  }
  const h = funnelFixture();
  h.namespace.get = async () => { throw Error('KV unavailable'); };
  await assert.rejects(readWstFunnelOrders(h.namespace), /KV unavailable/);
  h.namespace.list = async () => { throw Error('list unavailable'); };
  await assert.rejects(readWstFunnelOrders(h.namespace), /list unavailable/);
});

test('empty advancing KV pages are allowed; retention beyond the complete read limit fails', async () => {
  const h = funnelFixture(); const list = h.namespace.list; let first = true;
  h.namespace.list = async (args) => {
    if (first) { first = false; return { keys: [], list_complete: false, cursor: 'advance' }; }
    return list({ ...args, cursor: '' });
  };
  assert.equal((await readWstFunnelOrders(h.namespace)).length, 1);
  const many = funnelFixture(Array.from({ length: 1001 }, (_, i) => syntheticOrder(`s${String(i).padStart(4, '0')}`)));
  await assert.rejects(readWstFunnelOrders(many.namespace), /order read limit/);
  assert.equal(many.calls.get.length, 1000);
});

test('the total UTF-8 byte limit prevents a complete scan from exceeding its memory budget', async () => {
  const h = funnelFixture(Array.from({ length: 20 }, (_, i) => syntheticOrder(`s${String(i).padStart(2, '0')}`, { syntheticPadding: 'x'.repeat(900000) })));
  await assert.rejects(readWstFunnelOrders(h.namespace), /byte limit/);
  assert.ok(h.calls.get.length <= 13, 'at most the fixed in-flight pool can outlast the failing read');
  const unicode = funnelFixture([syntheticOrder('unicode', { syntheticPadding: '€'.repeat(400000) })]);
  await assert.rejects(readWstFunnelOrders(unicode.namespace), /byte limit/);
});
