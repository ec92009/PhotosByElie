import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const code = readFileSync(new URL('../analytics.js', import.meta.url), 'utf8');
function run({ origin = 'https://photos-by-elie.com', pathname = '/', gpc = false, dnt = '', windowDnt = '', preview = false } = {}) {
  const scripts = [];
  const window = { location: { origin, pathname }, doNotTrack: windowDnt, photosByElieMonitoringPreview: preview };
  const document = {
    currentScript: { src: `${origin}/analytics.js?v=321.0` },
    createElement: () => ({ dataset: {} }), body: { append: script => scripts.push(script) },
  };
  vm.runInNewContext(code, { window, document, navigator: { globalPrivacyControl: gpc, doNotTrack: dnt }, Set, URL, URLSearchParams });
  return { window, scripts };
}
test('approved storefront loads action map before sessionless beacon', () => {
  const { scripts, window } = run();
  assert.equal(scripts.length, 1);
  assert.match(scripts[0].src, /wst-actions/);
  scripts[0].onload();
  assert.equal(scripts[1].dataset.wstSite, 'photosbyelie');
  assert.equal(scripts[1].dataset.wstSessionless, 'true');
  assert.equal(scripts[1].dataset.wstEnvironment, 'production');
  assert.equal(window.photosByElieAnalytics.enabled(), false);
  assert.doesNotThrow(() => window.photosByElieAnalytics.track('payment_completed'));
});
test('local, foreign, preview, GPC and DNT send nothing', () => {
  for (const config of [{ origin: 'http://127.0.0.1:8099' }, { origin: 'https://example.com' }, { preview: true }, { gpc: true }, { dnt: '1' }]) assert.equal(run(config).scripts.length, 0);
});

test('the retained social fallback creates no session or traffic while disabled', () => {
  const social = ({ origin = 'https://photos-by-elie.com', preview = false, gpc = false, dnt = '' } = {}) => {
    const payloads = [];
    const sessions = new Map();
    const window = {
      location: new URL('/social.html', origin), photosByElieMonitoringPreview: preview,
      photosByElieMediaConfig: { analyticsWorkerBaseUrl: 'https://worker.example.test' },
      addEventListener() {},
    };
    const document = { body: { hasAttribute: () => false }, querySelector: () => null, addEventListener() {} };
    vm.runInNewContext(code, {
      window, document, URL, URLSearchParams, Set,
      navigator: { globalPrivacyControl: gpc, doNotTrack: dnt, sendBeacon: (url, body) => { payloads.push({ url, body }); return true; } },
      sessionStorage: { getItem: key => sessions.get(key), setItem: (key, value) => sessions.set(key, value) },
      crypto: { randomUUID: () => 'retained-native-session' },
      Blob: class { constructor(parts) { this.text = parts.join(''); } },
    });
    window.photosByElieAnalytics.track('basket_change');
    return { window, sessions, payloads };
  };
  for (const config of [
    { origin: 'http://localhost:8000' }, { origin: 'http://127.0.0.1:8000' },
    { origin: 'http://[::1]:8931' }, { preview: true }, { gpc: true }, { dnt: '1' },
  ]) {
    const result = social(config);
    assert.equal(result.window.photosByElieAnalytics.enabled(), false);
    assert.equal(result.sessions.size, 0);
    assert.equal(result.payloads.length, 0);
  }
  const deployed = social();
  assert.equal(deployed.window.photosByElieAnalytics.enabled(), true);
  assert.equal(deployed.sessions.size, 1);
  assert.equal(deployed.payloads.length, 2);
  assert.equal(JSON.parse(deployed.payloads[0].body.text).events[0].event, 'page_view');
  assert.equal(JSON.parse(deployed.payloads[1].body.text).events[0].event, 'basket_change');
});
test('order URLs expose no query or payment identifiers in configuration', () => {
  const { scripts } = run({ pathname: '/order.html' });
  scripts[0].onload();
  assert.equal(Object.keys(scripts[1].dataset).length, 7);
  assert.equal(scripts[1].dataset.wstPbeFunnel, 'false');
  assert.doesNotMatch(JSON.stringify(scripts), /session_id|order_id|buyerEmail/);
});

test('generated entity routes use the same sessionless production handoff and release identity', () => {
  for (const pathname of ['/photo--001-camera.html', '/gallery--france.html']) {
    const { scripts, window } = run({ pathname });
    assert.equal(scripts[0].src, '/wst-actions.js?v=321.0');
    scripts[0].onload();
    assert.equal(scripts[1].src, '/wst-beacon.js?v=321.0');
    assert.equal(scripts[1].dataset.wstSessionless, 'true');
    assert.equal(scripts[1].dataset.wstSite, 'photosbyelie');
    assert.equal(window.photosByElieAnalytics.enabled(), false);
  }
});

test('generated routes suppress local, IPv6, mesh, foreign, preview and privacy-opted-out collection', () => {
  const configs = [
    { origin: 'http://localhost:8000' }, { origin: 'http://127.0.0.1:8000' },
    { origin: 'http://[::1]:8931' }, { origin: 'http://max.local:8000' },
    { origin: 'http://100.64.0.1:8000' }, { origin: 'https://example.test' },
    { origin: 'https://www.photos-by-elie.com' },
    { preview: true }, { gpc: true }, { dnt: '1' }, { windowDnt: '1' },
  ];
  for (const pathname of ['/photo--001-camera.html', '/gallery--france.html']) {
    for (const config of configs) assert.equal(run({ ...config, pathname }).scripts.length, 0);
  }
});

function beaconHarness(pathname) {
  const payloads = [];
  const navigator = { language: 'en', webdriver: false, sendBeacon(_, body) { payloads.push(JSON.parse(body)); return true; } };
  const window = {
    location: new URL(`https://photos-by-elie.com${pathname}?id=private-photo&email=buyer@example.test#private`),
    crypto: { randomUUID: () => 'existing-event-id', getRandomValues() { assert.fail('sessionless beacon must not generate a session'); } },
    sessionStorage: {
      getItem() { assert.fail('sessionless beacon must not read session storage'); },
      setItem() { assert.fail('sessionless beacon must not write session storage'); },
    },
  };
  const document = {
    currentScript: { dataset: {
      wstEnabled: 'true', wstEndpoint: 'https://collector.example.test/v1/events',
      wstSite: 'photosbyelie', wstEnvironment: 'production', wstSessionless: 'true', wstConsent: 'not_required',
    } },
    documentElement: { lang: 'en' }, referrer: '', addEventListener() {},
  };
  vm.runInNewContext(readFileSync(new URL('../wst-beacon.js', import.meta.url), 'utf8'), {
    window, document, navigator, URL, URLSearchParams, Element: class {},
  });
  return { window, navigator, payloads };
}

test('entity paths normalize before transport and never add photo, query, form or visitor identity', () => {
  for (const [pathname, expected] of [
    ['/photo--001-camera.html', '/photo.html'], ['/gallery--france.html', '/gallery.html'],
    ['/photo.html', '/photo.html'], ['/gallery.html', '/gallery.html'],
  ]) {
    const h = beaconHarness(pathname);
    assert.equal(h.payloads.length, 1);
    assert.deepEqual(h.payloads[0].properties, { path: expected, locale: 'en' });
    h.window.WebSignals.track('cta_press', { cta_id: 'photo_open', email: 'private@example.test' });
    assert.equal(h.payloads.length, 2);
    assert.deepEqual(h.payloads[1].properties, { path: expected, locale: 'en', cta_id: 'photo_open' });
    assert.doesNotMatch(JSON.stringify(h.payloads), /001-camera|france|buyer@|private@|session_id|visitor_id|photo_id/);
    h.navigator.globalPrivacyControl = true;
    assert.equal(h.window.WebSignals.track('cta_press', { cta_id: 'photo_open' }), false);
    assert.equal(h.payloads.length, 2);
  }
});

test('static and dynamic generated links and the customer gear retain existing semantic action IDs', () => {
  let observe, click;
  class Element {
    constructor(tag, href = '', settings = false) { this.tag = tag; this.href = href; this.settings = settings; this.dataset = {}; this.nodeType = 1; }
    matches(selector) {
      const link = selector.match(/^a\[href\*="([^"]+)"\]$/);
      return Boolean(link && this.tag === 'a' && this.href.includes(link[1]))
        || (selector === '[data-settings-toggle]' && this.settings);
    }
    querySelectorAll() { return []; }
    closest() { return this; }
  }
  const photo = new Element('a', '/photo--001-camera.html');
  const gallery = new Element('a', '/gallery--france.html');
  const gear = new Element('button', '', true);
  const window = {};
  const document = {
    body: {}, querySelectorAll: selector => [photo, gallery, gear].filter(element => element.matches(selector)),
    addEventListener(_, callback) { click = callback; },
  };
  vm.runInNewContext(readFileSync(new URL('../wst-actions.js', import.meta.url), 'utf8'), {
    window, document, MutationObserver: class { constructor(callback) { observe = callback; } observe() {} },
  });
  assert.equal(photo.dataset.wstCta, 'photo_open');
  assert.equal(gallery.dataset.wstCta, 'gallery_open');
  assert.equal(gear.dataset.wstCta, 'display_settings');
  const added = new Element('a', '/photo--next.html');
  observe([{ addedNodes: [added] }]);
  assert.equal(added.dataset.wstCta, 'photo_open');
  const pressed = new Element('a', '/gallery--italy.html');
  click({ target: pressed });
  assert.equal(pressed.dataset.wstCta, 'gallery_open');
  assert.ok(window.PBEWebSignalsActions.ids.includes('checkout_start'));
});
