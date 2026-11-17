// Fail closed rather than describing a bounded prefix as a complete snapshot.
export const WST_FUNNEL_LIMITS = Object.freeze({ orders: 1000, pages: 100, pageSize: 100, concurrency: 4, recordBytes: 1024 * 1024, totalBytes: 8 * 1024 * 1024, cells: 10000, products: 100 });

export const evidenceError = (detail) => new Error(`WST funnel evidence is incomplete or malformed: ${detail}.`);
export const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export const identifier = (value) => typeof value === 'string' && value.length > 0 && value.length <= 300 && !/[\s\x00-\x1f]/.test(value);

/** A fixed worker pool stops scheduling reads on the first failure and drains in-flight reads. */
export async function boundedMap(values, callback) {
  const results = new Array(values.length);
  let next = 0, failure, failed = false;
  await Promise.all(Array.from({ length: Math.min(WST_FUNNEL_LIMITS.concurrency, values.length) }, async () => {
    while (!failed && next < values.length) {
      const index = next++;
      try { results[index] = await callback(values[index]); } catch (error) { failure = error; failed = true; }
    }
  }));
  if (failed) throw failure;
  return results;
}

/** Read every retained order key and value; neither missing records nor broken cursors are empty results. */
export async function readWstFunnelOrders(namespace, prefix = 'pbe') {
  if (typeof namespace?.list !== 'function' || typeof namespace?.get !== 'function' || !identifier(prefix)) {
    throw evidenceError('order readers unavailable');
  }
  const keyPrefix = `${prefix}:orders:`;
  const cursors = new Set();
  const orders = [];
  let cursor, lastName = '', totalBytes = 0;
  for (let index = 0; index < WST_FUNNEL_LIMITS.pages; index++) {
    const page = await namespace.list({ prefix: keyPrefix, limit: WST_FUNNEL_LIMITS.pageSize, ...(cursor ? { cursor } : {}) });
    if (!record(page) || !Array.isArray(page.keys) || page.keys.length > WST_FUNNEL_LIMITS.pageSize
      || typeof page.list_complete !== 'boolean'
      || (page.truncated !== undefined && page.truncated !== !page.list_complete)) throw evidenceError('order page');
    if (orders.length + page.keys.length > WST_FUNNEL_LIMITS.orders) throw evidenceError('order read limit exceeded');
    for (const entry of page.keys) {
      if (!record(entry) || typeof entry.name !== 'string' || !entry.name.startsWith(keyPrefix)
        || !identifier(entry.name.slice(keyPrefix.length)) || entry.name <= lastName) throw evidenceError('nonadvancing order keys');
      lastName = entry.name;
    }
    const values = await boundedMap(page.keys, async ({ name }) => {
      const text = await namespace.get(name, { type: 'text' });
      if (typeof text !== 'string' || text.length > WST_FUNNEL_LIMITS.recordBytes) throw evidenceError('missing or oversized order');
      const bytes = new TextEncoder().encode(text).byteLength;
      totalBytes += bytes;
      if (bytes > WST_FUNNEL_LIMITS.recordBytes || totalBytes > WST_FUNNEL_LIMITS.totalBytes) throw evidenceError('order byte limit exceeded');
      let order;
      try { order = JSON.parse(text); } catch { throw evidenceError('order JSON'); }
      if (!record(order) || !identifier(order.id) || name !== keyPrefix + order.id) throw evidenceError('order identity');
      return order;
    });
    orders.push(...values);
    if (page.list_complete) return orders;
    if (!identifier(page.cursor) || cursors.has(page.cursor)) throw evidenceError('nonadvancing order cursor');
    cursors.add(page.cursor);
    cursor = page.cursor;
  }
  throw evidenceError('order page limit exceeded');
}

/** Validate a retained UTC timestamp without Date.parse's calendar rollover. */
export function utcTimestamp(value, observedAt) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) throw evidenceError('UTC timestamp');
  const normalized = value.replace(/(?:\.(\d{1,3}))?Z$/, (_, millis) => `.${(millis || '').padEnd(3, '0')}Z`);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== normalized || milliseconds > observedAt) throw evidenceError('UTC timestamp');
  return normalized;
}
