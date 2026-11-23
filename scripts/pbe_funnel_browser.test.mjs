import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

/** Run the real adapter and deferred beacon without any real network or storage. */
function browser({ url = 'https://photos-by-elie.com/photo--synthetic.html?id=query-private', enabled = true, privacy = {}, referrer = '', beaconAccepts = true } = {}) {
  const scripts = [], sent = [], fallback = [], listeners = new Map();
  let ids = 0;
  const window = { location: new URL(url), addEventListener() {},
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`, getRandomValues() { assert.fail('no session'); } },
    sessionStorage: { getItem() { assert.fail('no session'); }, setItem() { assert.fail('no session'); }, removeItem() {} },
    fetch: (url, options) => { fallback.push({ url, options, payload: JSON.parse(options.body) }); return Promise.reject(Error('synthetic network failure')); },
  };
  const navigator = { language: 'en', sendBeacon: (_, body) => { sent.push(JSON.parse(body)); return beaconAccepts; }, ...privacy };
  const document = { currentScript: { src: `${window.location.origin}/analytics.js?v=321.7`, dataset: { wstPbeFunnel: String(enabled) } },
    documentElement: { lang: 'en' }, referrer, createElement: () => ({ dataset: {} }),
    body: { dataset: {}, hasAttribute: () => false, append: (script) => scripts.push(script) },
    querySelector: () => null, addEventListener: (name, callback) => listeners.set(name, callback) };
  const context = vm.createContext({ window, document, navigator, URL, URLSearchParams, Element: class {}, sessionStorage: window.sessionStorage });
  vm.runInContext(read('analytics.js'), context);
  return { window, document, navigator, scripts, sent, fallback, listeners,
    load() {
      if (!scripts[0]) return;
      scripts[0].onload(); scripts[0].onload(); // A repeated load callback must not install twice.
      if (!scripts[1]) return;
      document.currentScript = scripts[1];
      vm.runInContext(read('wst-beacon.js'), context);
      scripts[1].onload(); scripts[1].onload();
    } };
}

test('off-by-default rollout emits legacy shapes only, with no raw campaign or referrer dimensions', () => {
  const h = browser({ enabled: false, url: 'https://photos-by-elie.com/photo.html?utm_source=private&utm_term=buyer@example.test', referrer: 'https://private-referrer.example/path' });
  h.window.photosByElieAnalytics.track('product_ready'); h.window.photosByElieAnalytics.track('basket_add'); h.load();
  assert.equal(h.scripts[1].dataset.wstPbeFunnel, 'false');
  assert.equal(h.sent.length, 1);
  assert.deepEqual(h.sent[0].properties, { path: '/photo.html', locale: 'en' });
  assert.equal(h.window.WebSignals.track('pbe_stage', { stage: 'product_ready' }), false);
  for (const page of ['photo.html', 'gallery.html', 'basket.html', 'liked.html', 'index.html']) assert.match(read(page), /analytics\.js\?v=[^"']+["']\s+data-wst-pbe-funnel=["']true["']/);
});

test('early stages flush once, product readiness latches synchronously and no server stage can be sent', () => {
  const h = browser();
  assert.equal(h.window.photosByElieAnalytics.track('product_ready'), true);
  assert.equal(h.window.photosByElieAnalytics.track('product_ready'), false);
  h.window.photosByElieAnalytics.track('basket_add'); h.load();
  assert.equal(h.scripts.length, 2);
  assert.deepEqual(h.sent.map((event) => event.properties.stage).filter(Boolean), ['product_ready', 'basket_add']);
  for (const name of ['checkout_created', 'payment_accepted', 'delivery_ready', 'payment_completed']) {
    assert.equal(h.window.photosByElieAnalytics.track(name), false);
    assert.equal(h.window.WebSignals.track('pbe_stage', { stage: name }), false);
  }
  h.window.photosByElieAnalytics.track('product_ready'); h.window.photosByElieAnalytics.track('basket_add');
  assert.equal(h.sent.length, 4);
  assert.equal(new Set(h.sent.map((event) => event.event_id)).size, 4);
  assert.doesNotMatch(JSON.stringify(h.sent), /synthetic\.html|query-private|session_id|visitor_id|buyer|photo_id/);
  const gallery = browser({ url: 'https://photos-by-elie.com/gallery--france.html' }); gallery.load();
  assert.equal(gallery.window.photosByElieAnalytics.track('product_ready'), false);
});

test('generated routes normalize and detail query identity keeps precedence over body identity', async () => {
  const source = read('photo-detail.js');
  const prelude = source.slice(0, source.indexOf('const ownerReviewDetailPhotoStateKey'));
  for (const [route, expected] of [['/photo--body-private.html', 'body-private'], ['/photo--body-private.html?id=query-private', 'query-private'], ['/photo.html?id=query-private', 'query-private']]) {
    const h = browser({ url: `https://photos-by-elie.com${route}` }); h.load();
    h.window.photosByEliePageReady = async () => {};
    h.document.body.dataset.photoId = 'body-private';
    const result = await vm.runInNewContext(prelude + 'return requestedPhotoId;})());', { window: h.window, document: h.document, URLSearchParams });
    assert.equal(result, expected);
    h.window.photosByElieAnalytics.track('product_ready');
    assert.equal(h.sent.at(-1).properties.path, '/photo.html');
    assert.doesNotMatch(JSON.stringify(h.sent), /body-private|query-private/);
  }
});

test('acquisition is finite, page-local, and never leaks arbitrary UTM or referrer hosts', () => {
  for (const [query, referrer, expected] of [
    ['', '', 'direct'], ['?utm_source=google&utm_term=private', '', 'search'], ['?utm_source=Instagram', '', 'social'],
    ['?utm_source=newsletter', '', 'email'], ['?utm_source=private-buyer', '', 'campaign_other'],
    ['', 'https://photos-by-elie.com/gallery.html', 'internal'], ['', 'https://www.google.es/search?q=private', 'search'],
    ['', 'https://www.pinterest.com/private', 'social'], ['', 'https://private-referrer.example/path', 'referral'], ['', 'invalid referrer', 'unknown'],
  ]) {
    const h = browser({ url: `https://photos-by-elie.com/photo.html${query}`, referrer }); h.load();
    h.window.photosByElieAnalytics.track('product_ready');
    assert.equal(h.sent.at(-1).properties.acquisition_source, expected);
    assert.doesNotMatch(JSON.stringify(h.sent), /private|campaign"|referrer_site|utm_|session_id/);
  }
});

test('local/IPv6/mesh/foreign/Owner/preview/bot/privacy traffic stays suppressed', () => {
  for (const config of [
    ...['http://localhost:8000', 'http://127.0.0.1:8000', 'http://[::1]:8000', 'http://max.local:8000', 'http://100.64.0.1:8000', 'https://www.photos-by-elie.com', 'https://foreign.example'].map((origin) => ({ url: `${origin}/photo--private.html` })),
    { url: 'https://photos-by-elie.com/owner.html' }, { url: 'https://photos-by-elie.com/photo.html?from=owner-review' },
    { url: 'https://photos-by-elie.com/photo.html?gallery=pbe%2Downer' },
    { privacy: { globalPrivacyControl: true } }, { privacy: { doNotTrack: '1' } }, { privacy: { webdriver: true } }, { privacy: { userAgent: 'Googlebot' } },
  ]) {
    const h = browser(config); h.window.photosByElieAnalytics.track('product_ready'); h.load();
    assert.equal(h.sent.length, 0, JSON.stringify(config)); assert.equal(h.fallback.length, 0);
  }
  for (const change of [(h) => { h.window.photosByElieMonitoringPreview = true; }, (h) => { h.window.doNotTrack = '1'; },
    (h) => { h.navigator.globalPrivacyControl = true; }, (h) => { h.document.body.dataset.ownerDetailMode = 'true'; }]) {
    const h = browser(); h.window.photosByElieAnalytics.track('product_ready'); change(h); h.load();
    assert.equal(h.sent.length, 0, 'suppression is rechecked before queued transport');
  }
  const h = browser(); h.load(); h.navigator.globalPrivacyControl = true;
  h.window.WebSignals.setConsent('granted'); h.window.photosByElieAnalytics.track('basket_add');
  assert.equal(h.sent.length, 1, 'consent cannot override a dynamic browser privacy signal');
});

test('fallback retries reuse exactly the same ID and silent failure cannot fail UI actions', async () => {
  const h = browser({ beaconAccepts: false }); h.load(); h.window.photosByElieAnalytics.track('basket_add');
  await new Promise(setImmediate);
  assert.equal(h.sent.length, 2); assert.equal(h.fallback.length, 2);
  for (let i = 0; i < h.sent.length; i++) assert.deepEqual(h.sent[i], h.fallback[i].payload);
  assert.notEqual(h.sent[0].event_id, h.sent[1].event_id);
  h.navigator.sendBeacon = () => { throw Error('blocked beacon'); };
  h.window.fetch = () => { throw Error('blocked fetch'); };
  assert.doesNotThrow(() => h.window.photosByElieAnalytics.track('basket_add'));
  h.window.WebSignals = { track: () => { throw Error('unavailable'); } };
  assert.doesNotThrow(() => h.window.photosByElieAnalytics.track('basket_add'));
  const failed = browser(); failed.scripts[0].onload(); failed.scripts[1].onerror();
  assert.equal(failed.window.photosByElieAnalytics.track('basket_add'), false);
  const queued = browser();
  for (let i = 0; i < 100; i++) queued.window.photosByElieAnalytics.track('basket_add');
  queued.load(); assert.equal(queued.sent.length, 51, 'pending events have a fixed limit');
});

function basketHarness() {
  const stages = [], values = new Map(); let reenter;
  const photo = { id: 'photo', title: 'Synthetic' };
  const window = { photosByElieData: { synthetic: { title: 'Synthetic', photos: [photo] } },
    photosByElieResolutions: [{ id: 'small', price: 8 }, { id: 'large', price: 16 }],
    photosByElieAnalytics: { track: (name) => { stages.push(name); reenter?.(); } }, dispatchEvent: () => {} };
  const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  vm.runInNewContext(read('basket-store.js'), { window, localStorage: storage, CustomEvent: class {} });
  return { window, store: window.photosByElieBasket, stages, values, storage, reenter: (fn) => { reenter = fn; } };
}

test('successful explicit basket additions count once; restoration, replays, removals and rejected options do not', () => {
  const h = basketHarness(), item = { photoId: 'photo', options: [{ id: 'small' }] }, user = { userInitiated: true };
  h.store.setPhotoOptions(item); h.store.write(h.store.read()); h.store.setPhotoOptions(item, user);
  assert.equal(h.stages.length, 0);
  h.store.setPhotoOptions({ ...item, options: [{ id: 'small' }, { id: 'large' }] }, user);
  assert.deepEqual(h.stages, ['basket_add']);
  h.store.setPhotoOptions({ ...item, options: [{ id: 'invalid' }] }, user);
  h.store.setPhotoOptions({ photoId: 'absent', options: [{ id: 'small' }] }, user);
  h.store.remove(0); assert.equal(h.stages.length, 1);
  h.reenter(() => h.store.setPhotoOptions(item, user));
  h.store.add(item, user); assert.equal(h.stages.length, 2, 'reentrant analytics cannot duplicate the synchronous mutation');
  h.store.add(item, user); assert.equal(h.stages.length, 2);
  h.reenter(null); h.store.updateOptions(0, ['small', 'large'], user); assert.equal(h.stages.length, 3);
  h.window.photosByElieIsPublicHidden = () => true;
  h.store.clear(); h.store.add(item, user); assert.equal(h.stages.length, 3);
});

test('failed durable storage emits no addition and releases the mutation lock', () => {
  const h = basketHarness(), write = h.storage.setItem;
  h.storage.setItem = () => { throw Error('quota'); };
  const item = { photoId: 'photo', options: [{ id: 'small' }] };
  assert.throws(() => h.store.setPhotoOptions(item, { userInitiated: true }), /quota/); assert.equal(h.stages.length, 0);
  h.storage.setItem = write;
  h.store.setPhotoOptions(item, { userInitiated: true }); assert.equal(h.stages.length, 1);
});

test('real photo and liked controllers mark explicit UI changes while liked navigation flush stays restoration', () => {
  const h = basketHarness(), photo = { id: 'photo', title: 'Synthetic' }, selection = [{ id: 'small' }];
  const context = vm.createContext({ window: h.window, photo, collection: { title: 'Synthetic' }, basketStore: h.store,
    selectedOptions: () => selection, basketItemForPhoto: () => h.store.read()[0], updateTotal() {},
    status: {}, t: (key) => key });
  const detail = read('photo-detail.js'), start = detail.indexOf('  const syncSelectionToBasket =');
  vm.runInContext(detail.slice(start, detail.indexOf('  document.querySelectorAll', start)) + '\nsyncSelectionToBasket(); syncSelectionToBasket();', context);
  assert.equal(h.stages.length, 1);
  h.store.clear();
  Object.assign(context, { likedStore: { read: () => [{ photoId: 'photo', title: 'Synthetic' }] },
    checkedLikedSelectionsFor: () => selection, optionPayload: (options) => options, renderLiked() {},
    document: { querySelectorAll: () => [{ dataset: { likedResolution: '0' } }] } });
  const liked = read('liked.js');
  vm.runInContext(liked.slice(liked.indexOf('const syncLikedSelectionToBasket ='), liked.indexOf('const ensureMoreButton ='))
    + '\nflushVisibleLikedSelectionsToBasket();', context);
  assert.equal(h.stages.length, 1, 'navigation flush cannot manufacture a user addition');
  h.store.clear();
  vm.runInContext('syncLikedSelectionToBasket(0, { render: true, userInitiated: true });', context);
  assert.equal(h.stages.length, 2);
});

test('changing the quantity or frame of an existing option is not another basket addition', () => {
  const h = basketHarness(); h.window.photosByElieResolutions.push({ id: 'print', type: 'print', price: 10 });
  const item = { photoId: 'photo', options: [{ id: 'print', quantity: 1 }] }, user = { userInitiated: true };
  h.store.setPhotoOptions(item, user);
  h.store.setPhotoOptions({ ...item, options: [{ id: 'print', quantity: 2, frameId: 'white' }] }, user);
  assert.equal(h.stages.length, 1);
});

/** Run the controller's actual media/readiness block with delayed or cached image events. */
function productHarness({ cached = false, video = false } = {}) {
  const stages = [], nodes = [], photo = { id: 'synthetic', title: 'Synthetic' };
  const main = { dataset: { customerState: 'loading' } }, panel = { hidden: false };
  const window = { photosByElieData: { synthetic: { photos: [photo] } }, photosByElieAnalytics: { track: (name) => stages.push(name) } };
  const document = { querySelector: (selector) => ({ main, '.purchase-panel': panel, '[data-resolution]': {} }[selector]),
    createElement() { const node = { complete: cached, naturalWidth: cached ? 400 : 0, naturalHeight: cached ? 300 : 0, addEventListener(name, fn) { this[name] = fn; } }; nodes.push(node); return node; } };
  const context = vm.createContext({ window, document, photo, ownerDetailPurchaseHidden: false, localModerationEnabled: false,
    isVideo: video, detailImageSrc: '/synthetic.jpg', preview: { classList: { add() {} }, prepend() {} }, applyPreviewAspectRatio() {} });
  const source = read('photo-detail.js');
  vm.runInContext(source.slice(source.indexOf('let purchaseControlsReady = false;'), source.indexOf('if (isPanorama) {', source.indexOf('let purchaseControlsReady = false;'))), context);
  return { stages, window, main, panel, context, image: nodes[0],
    finish() { main.dataset.customerState = 'ready'; vm.runInContext('purchaseControlsReady = true; reportProductReady();', context); },
    load() { nodes[0].naturalWidth = 400; nodes[0].naturalHeight = 300; nodes[0].load?.(); } };
}

test('product_ready waits for usable media and finished purchase UI, once for cached and delayed loads', () => {
  for (const cached of [false, true]) {
    const h = productHarness({ cached });
    assert.equal(h.stages.length, 0); h.finish(); assert.equal(h.stages.length, cached ? 1 : 0);
    h.load(); h.load(); h.finish(); assert.deepEqual(h.stages, ['product_ready']);
  }
  const h = productHarness(); h.load(); assert.equal(h.stages.length, 0); h.finish(); assert.equal(h.stages.length, 1);
  assert.match(read('photo-detail.js'), /CustomerRecovery\?\.ready\(\);\s*reportProductReady\(\);/);
});

test('failed media, revoked identity, hidden/Owner controls and recovery failure are not product readiness', () => {
  const failed = productHarness(); failed.finish(); failed.image.load(); assert.equal(failed.stages.length, 0);
  for (const change of [(h) => { h.window.photosByElieIsPublicHidden = () => true; }, (h) => { h.window.photosByElieData = {}; },
    (h) => { h.panel.hidden = true; }, (h) => { h.context.ownerDetailPurchaseHidden = true; }, (h) => { h.context.localModerationEnabled = true; }]) {
    const h = productHarness(); change(h); h.load(); h.finish(); assert.equal(h.stages.length, 0);
  }
  const recovery = productHarness(); recovery.finish(); recovery.main.dataset.customerState = 'unavailable'; recovery.load(); assert.equal(recovery.stages.length, 0);
  const video = productHarness({ video: true }); video.finish(); assert.equal(video.stages.length, 0, 'video metadata alone is not photo readiness');
});
