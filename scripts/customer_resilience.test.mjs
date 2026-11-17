import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('Customer settings constrain height and scroll when native zoom reduces the viewport', () => {
  assert.match(read('shared.css'), /\.site-settings-dialog\{\s*max-height:calc\(100dvh[^}]+overflow-y:auto;[^}]+overscroll-behavior:contain;/);
});

test('Gallery action-label settings use the existing EN/FR/ES translation contract', () => {
  assert.match(read('photo-gallery.js'), /data-i18n="settings.action_labels"/);
  for (const label of ['Show action labels', 'Afficher les libellés des actions', 'Mostrar etiquetas de acciones']) {
    assert.ok(read('photos.js').includes(`'settings.action_labels': '${label}'`));
  }
});

test('Account profile restoration preserves System while restoring durable gallery checkpoints', () => {
  const source = read('photos.js');
  const start = source.indexOf('  const applyAccountProfileToStores =');
  const end = source.indexOf('\n  const saveAccountProfile =', start);
  assert.ok(start > 0 && end > start);
  const incoming = [{ collectionKey: 'france', photoId: 'restored', updatedAt: '2026-11-17T10:00:00Z' }];
  const saved = [{ collectionKey: 'spain', photoId: 'saved', updatedAt: '2026-11-16T10:00:00Z' }];
  for (const preference of ['system', 'light', 'dark']) {
    const calls = [];
    const context = {
      applyingAccountProfile: false,
      accountStoresAvailable: () => false,
      window: { photosByElieTheme: { preference: () => preference } },
      setLanguage: (language) => calls.push(['language', language]),
      setTheme: (theme) => calls.push(['theme', theme]),
      readGalleryCheckpoints: () => saved,
      mergeGalleryCheckpoints: (...groups) => groups.flat(),
      storeGalleryCheckpoints: (checkpoints) => calls.push(['checkpoints', checkpoints]),
    };
    const restore = vm.runInNewContext(source.slice(start, end) + '\napplyAccountProfileToStores;', context);
    restore({ language: 'fr', theme: 'dark', galleryCheckpoints: incoming });
    assert.deepEqual(calls.filter(([kind]) => kind === 'theme'), preference === 'system' ? [] : [['theme', 'dark']]);
    assert.deepEqual(calls.find(([kind]) => kind === 'checkpoints')[1], [...saved, ...incoming]);
    assert.equal(context.applyingAccountProfile, false);
  }
});

function themeHarness({ saved = {}, denied = false, quota = false, dark = false } = {}) {
  const values = new Map(Object.entries(saved));
  const events = new Map();
  const media = { matches: dark, addEventListener: (_, callback) => { media.change = callback; } };
  const window = { matchMedia: () => media, addEventListener: (name, callback) => events.set(name, callback) };
  const localStorage = {
    getItem(key) { if (denied) throw Error('SecurityError'); return values.get(key) ?? null; },
    setItem(key, value) { if (denied || quota) throw Error('QuotaExceeded'); values.set(key, String(value)); },
    removeItem(key) { if (denied) throw Error('SecurityError'); values.delete(key); },
  };
  vm.runInNewContext(read('theme-preference.js'), { window, localStorage });
  return { api: window.photosByElieTheme, window, values, media, events };
}

test('System responds to OS changes; explicit Day/Night ignore them and reload persists preference', () => {
  const h = themeHarness({ dark: true });
  const notices = [];
  h.api.subscribe((theme, preference) => notices.push([theme, preference]));
  assert.deepEqual(notices.at(-1), ['dark', 'system']);
  h.media.matches = false; h.media.change();
  assert.deepEqual(notices.at(-1), ['light', 'system']);
  h.api.set('night');
  const length = notices.length;
  h.media.matches = true; h.media.change();
  assert.equal(notices.length, length);
  assert.equal(h.api.resolved(), 'dark');
  h.api.set('day'); assert.equal(h.api.resolved(), 'light');
  h.api.set('system');
  assert.equal(themeHarness({ saved: Object.fromEntries(h.values), dark: true }).api.preference(), 'system');
  for (const invalid of ['__proto__', 'constructor', {}, null]) assert.equal(h.api.normalize(invalid), 'system');
});

test('Denied storage and quota keep theme, display and language changes usable in memory', () => {
  for (const config of [{ denied: true }, { quota: true, saved: { 'byelie-theme': 'light' } }]) {
    const h = themeHarness(config);
    let calls = 0; h.api.subscribe(() => calls++);
    h.api.set('dark'); assert.equal(h.api.resolved(), 'dark');
    assert.equal(h.api.storage.getItem('byelie-theme'), 'dark');
    h.api.storage.setItem('byelie-language', 'fr');
    h.api.storage.setItem('photosbyelie-display-settings', '{"transparency":80}');
    assert.equal(h.api.storage.getItem('byelie-language'), 'fr');
    assert.equal(JSON.parse(h.api.storage.getItem('photosbyelie-display-settings')).transparency, 80);
    h.api.storage.removeItem('byelie-theme'); assert.equal(h.api.storage.getItem('byelie-theme'), null);
    assert.equal(calls, 2);
  }
});

test('Theme changes in another tab refresh the active preference', () => {
  const h = themeHarness(); h.api.set('light');
  h.values.set('byelie-theme', 'system'); h.media.matches = true;
  h.events.get('storage')({ key: 'byelie-theme' });
  assert.equal(h.api.preference(), 'system'); assert.equal(h.api.resolved(), 'dark');
});

function recoveryHarness(language = 'en') {
  const events = new Map();
  const node = () => ({ dataset: {}, hidden: false, textContent: '', setAttribute(key, value) { this[key] = value; }, addEventListener(key, fn) { this[key] = fn; } });
  const main = node(), status = node(), retry = node(), link = node(), region = node();
  const children = { '[role="status"]': status, button: retry, a: link };
  region.querySelector = (selector) => children[selector];
  const document = { documentElement: { lang: language }, querySelector: (selector) => selector === 'main' ? main : region };
  let reloads = 0, timeout;
  const window = { addEventListener: (name, fn) => events.set(name, fn), setTimeout(fn) { timeout = fn; return 1; }, clearTimeout() {}, location: { href: 'https://example.test/photo--one.html?id=one#selection', reload() { reloads++; } } };
  const savedBasket = '[{"photoId":"one","options":[{"id":"large"}]}]';
  const localStorage = { getItem: () => savedBasket, setItem() { assert.fail('recovery must not write basket'); }, removeItem() { assert.fail('recovery must not remove basket'); } };
  vm.runInNewContext(read('customer-recovery.js'), { window, document, localStorage });
  return { window, document, main, region, status, retry, link, events, localStorage, savedBasket, reloads: () => reloads, timeout: () => timeout() };
}

test('Localized loading, failure, retry and recovery preserve URL and basket without payment requests', () => {
  for (const [language, loading, unavailable, label] of [['en', /Loading/, /unavailable/, 'Try again'], ['fr', /Chargement/, /indisponibles/, 'Réessayer'], ['es', /Cargando/, /disponibles/, 'Reintentar']]) {
    const h = recoveryHarness(language);
    assert.match(h.status.textContent, loading); assert.equal(h.main['aria-busy'], 'true');
    h.window.photosByElieCustomerRecovery.fail(new Error('Lifecycle visibility authority failed HTTP 503'));
    assert.match(h.status.textContent, unavailable); assert.doesNotMatch(h.status.textContent, /Lifecycle|503/);
    assert.equal(h.main['aria-busy'], 'false'); assert.equal(h.retry.textContent, label); assert.equal(h.retry.hidden, false);
    const url = h.window.location.href;
    h.retry.click(); h.retry.click();
    assert.equal(h.reloads(), 1); assert.equal(h.retry.disabled, true);
    assert.equal(h.localStorage.getItem(), h.savedBasket); assert.equal(h.window.location.href, url);
    h.window.photosByElieCustomerRecovery.ready(); assert.equal(h.region.hidden, true); assert.equal(h.main.dataset.customerState, 'ready');
  }
});

test('Slow loads offer recovery; language changes translate failure; denied storage has distinct guidance', () => {
  const h = recoveryHarness(); h.timeout(); assert.equal(h.main.dataset.customerState, 'unavailable');
  h.document.documentElement.lang = 'fr'; h.events.get('photosbyelie:languagechange')(); assert.equal(h.retry.textContent, 'Réessayer');
  h.window.photosByElieCustomerRecovery.fail('storage'); assert.match(h.status.textContent, /stockage/);
});

test('Catalog rejection and visibility 503 terminate every controller without exposing internal errors', async () => {
  for (const file of ['photo-gallery.js', 'photo-detail.js', 'basket.js']) {
    for (const error of ['Catalog fetch blocked', 'Lifecycle visibility failed with HTTP 503.']) {
      const h = recoveryHarness('es');
      h.window.location.search = '?gallery=france&id=one';
      h.window.photosByEliePageReady = async () => { throw Error(error); };
      if (file === 'basket.js') h.window.photosByElieCatalogReady = Promise.reject(Error(error));
      // An error before content construction should need no catalog/media/store APIs.
      h.document.body = { dataset: {} };
      h.document.head = { querySelector: () => ({}), append() {} };
      h.document.querySelector = (selector) => selector === 'main' ? h.main : null;
      await vm.runInNewContext(read(file), { window: h.window, document: h.document, URL, URLSearchParams });
      assert.equal(h.main.dataset.customerState, 'unavailable', file);
      assert.match(h.status.textContent, /disponibles/); assert.doesNotMatch(h.status.textContent, /Lifecycle|503|blocked/);
      assert.equal(h.localStorage.getItem(), h.savedBasket);
    }
  }
});

test('Checkout synchronously latches before an await and suppresses reentrant requests', async () => {
  const source = read('basket.js');
  const start = source.indexOf('let checkoutStarting = false;');
  const end = source.indexOf('\nmockPay?.', start);
  assert.ok(start > 0 && end > start);
  let handler, release, requests = 0, statuses = 0;
  const pending = new Promise((resolve) => { release = resolve; });
  const button = { disabled: false, addEventListener(_, fn) { handler = fn; } };
  const sandbox = { checkoutGuest: button, setBasketStatus() { statuses++; }, t: (key) => key,
    signedInAccountEmail: () => '', checkoutEmail: { value: 'buyer@example.test' }, validCheckoutEmail: () => true,
    discountCodeInput: null, deliveryAvailabilityLoaded: false,
    ensureDeliveryAvailabilityLoaded: () => { requests++; return pending; },
    basketStore: { read: () => [], write: (items) => items }, pruneUnavailableBasketSelections: (items) => items,
    digitalCheckoutItems: () => [], renderBasket() {}, removeMissingDeliverySelections: () => false };
  vm.runInNewContext(source.slice(start, end), sandbox);
  const first = handler(); assert.equal(button.disabled, true); assert.equal(statuses, 2);
  await handler(); assert.equal(requests, 1);
  release(); await first; assert.equal(button.disabled, false);
  await handler(); assert.equal(requests, 2); // latch released on the no-items terminal path
});

test('Customer shells expose no-JS guidance, polite live status, and early theme bootstrap', () => {
  for (const file of ['gallery.html', 'photo.html', 'basket.html']) {
    const html = read(file);
    assert.match(html, /<noscript>[\s\S]*lang="en"[\s\S]*lang="fr"[\s\S]*lang="es"/);
    assert.match(html, /role="status" aria-live="polite" aria-atomic="true"/);
    assert.ok(html.indexOf('theme-preference.js') < html.indexOf('photos.js'));
    assert.ok(html.indexOf('customer-recovery.js') < html.indexOf('photos-data.js'));
    assert.match(html, /<main data-customer-state="loading"/);
  }
});

test('Checkout sends one request while pending, releases on failure, and stays latched for redirect', async () => {
  const source = read('basket.js');
  const start = source.indexOf('let checkoutStarting = false;');
  const end = source.indexOf('\nmockPay?.', start);
  for (const rejectRequest of [true, false]) {
    let handler, settle, requests = 0, redirects = 0;
    const pending = new Promise((resolve, reject) => { settle = rejectRequest ? reject : resolve; });
    const button = { disabled: false, addEventListener(_, fn) { handler = fn; } };
    const sandbox = { checkoutGuest: button, setBasketStatus() {}, t: (key) => key,
      signedInAccountEmail: () => '', checkoutEmail: { value: 'buyer@example.test' }, validCheckoutEmail: () => true,
      discountCodeInput: null, deliveryAvailabilityLoaded: true,
      basketStore: { read: () => [], write: (items) => items }, pruneUnavailableBasketSelections: (items) => items,
      digitalCheckoutItems: () => [{ photoId: 'one' }], checkRecentPurchases: async () => null,
      basketDigitalSubtotalCents: () => 100, checkoutFetch() { requests++; return pending; },
      setCheckoutState() {}, renderCheckoutResult() {}, syncCheckoutControls() {}, renderBasket() {},
      removeMissingDeliverySelections: () => false, window: { location: { assign() { redirects++; } } } };
    vm.runInNewContext(source.slice(start, end), sandbox);
    const first = handler();
    await new Promise(setImmediate); // drain the VM and host promise queues
    assert.equal(requests, 1);
    await handler(); assert.equal(requests, 1);
    settle(rejectRequest ? Error('network') : { order: { id: 'order' }, checkout: { sessionId: 'session', provider: 'stripe', url: 'https://checkout.stripe.test/one' } });
    await first;
    assert.equal(button.disabled, !rejectRequest);
    if (!rejectRequest) { await handler(); assert.equal(requests, 1); assert.equal(redirects, 1); }
  }
});

test('Basket refuses to display a false empty state when stored selections are unreadable', async () => {
  const h = recoveryHarness('fr');
  h.window.photosByElieCatalogReady = Promise.resolve();
  await vm.runInNewContext(read('basket.js'), { window: h.window, localStorage: { getItem() { throw Error('SecurityError'); } } });
  assert.equal(h.main.dataset.customerState, 'storage');
  assert.match(h.status.textContent, /stockage/);
  assert.equal(h.localStorage.getItem(), h.savedBasket);
});
