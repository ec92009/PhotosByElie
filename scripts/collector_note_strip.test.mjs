import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function makeElement(tag = 'div', attrs = {}) {
  const listeners = new Map();
  const classSet = new Set();
  const attributes = new Map(Object.entries(attrs));
  const el = {
    tagName: tag.toUpperCase(),
    dataset: {},
    value: '',
    textContent: '',
    disabled: false,
    hidden: false,
    focused: false,
    children: [],
    className: '',
    href: '',
    target: '',
    rel: '',
    classList: {
      toggle(name, force) {
        const next = force === undefined ? !classSet.has(name) : Boolean(force);
        if (next) classSet.add(name);
        else classSet.delete(name);
        return next;
      },
      contains(name) { return classSet.has(name); },
    },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    async dispatch(type, event = {}) {
      const fns = listeners.get(type) || [];
      for (const fn of fns) await fn(event);
    },
    focus() { el.focused = true; },
    append(...nodes) { el.children.push(...nodes); },
    replaceChildren(...nodes) { el.children = [...nodes]; },
  };
  return el;
}

function bootCollectorRuntime({ source = 'photo', gallery = '', search = '', lang = 'en', fetchImpl } = {}) {
  const section = makeElement('section');
  section.dataset.collectorSource = source;
  const form = makeElement('form');
  const emailInput = makeElement('input');
  const trapInput = makeElement('input');
  const submitButton = makeElement('button');
  const status = makeElement('p');
  const packContainer = makeElement('div');
  packContainer.hidden = true;
  const packList = makeElement('ul');

  const elements = {
    '#collector-note': section,
    '#collector-note-form': form,
    '#collector-email': emailInput,
    '#collector-website': trapInput,
    '#collector-submit': submitButton,
    '#collector-status': status,
    '#collector-wallpapers': packContainer,
    '#collector-wallpapers-list': packList,
  };

  const document = {
    readyState: 'complete',
    documentElement: { dataset: { language: lang }, lang },
    body: { dataset: gallery ? { gallery } : {} },
    querySelector: (sel) => elements[sel] || null,
    createElement: (tag) => makeElement(tag),
    addEventListener() {},
  };

  const windowObj = {
    location: { hostname: 'photos-by-elie.com', search },
    photosByElieMediaConfig: { authWorkerBaseUrl: 'https://auth.photos-by-elie.com' },
    photosByElieI18n: {
      language: () => lang,
      t: (key) => key,
    },
  };

  const sandbox = {
    window: windowObj,
    document,
    URLSearchParams,
    fetch: fetchImpl || (async () => { throw new Error('unexpected fetch'); }),
  };

  const code = fs.readFileSync(path.join(root, 'collector-note.js'), 'utf8');
  vm.runInNewContext(code, sandbox, { timeout: 1000 });
  return { section, form, emailInput, trapInput, submitButton, status, packContainer, packList, api: windowObj.photosByElieCollectorNote };
}

test('photo.html and gallery.html include subtle Collector Note CTA and script in public artifact manifest', () => {
  const photoHtml = fs.readFileSync(path.join(root, 'photo.html'), 'utf8');
  const galleryHtml = fs.readFileSync(path.join(root, 'gallery.html'), 'utf8');
  const sharedCss = fs.readFileSync(path.join(root, 'shared.css'), 'utf8');
  const policy = JSON.parse(fs.readFileSync(path.join(root, 'scripts/public-artifact-files.json'), 'utf8'));

  assert.ok(policy.files.includes('collector-note.js'), 'collector-note.js must be in public-artifact-files.json');
  assert.match(photoHtml, /<section class="panel collector-note-strip" id="collector-note" data-collector-source="photo"/);
  assert.match(photoHtml, /<script src="\.\/collector-note\.js\?v=[^"]+"><\/script>/);
  assert.match(galleryHtml, /<section class="panel collector-note-strip" id="collector-note" data-collector-source="gallery"/);
  assert.match(galleryHtml, /<script src="\.\/collector-note\.js\?v=[^"]+"><\/script>/);

  // Subtle placement: must remain after primary purchase panel / gallery grid.
  assert.ok(photoHtml.indexOf('class="panel purchase-panel"') < photoHtml.indexOf('id="collector-note"'));
  assert.ok(galleryHtml.indexOf('data-gallery-root') < galleryHtml.indexOf('id="collector-note"'));

  // Hidden until customer readiness gate passes and aligned cleanly with basket rail.
  assert.match(sharedCss, /main\[data-customer-state\]:not\(\[data-customer-state="ready"\]\) \.collector-note-strip/);
  assert.match(sharedCss, /main\.has-basket-rail > \.collector-note-strip/);
});

test('photos.js defines EN, FR, and ES translations for all collector.* keys', () => {
  const photosJs = fs.readFileSync(path.join(root, 'photos.js'), 'utf8');
  const keys = [
    'collector.eyebrow',
    'collector.title',
    'collector.body',
    'collector.email_label',
    'collector.submit',
    'collector.fineprint',
    'collector.pack_title',
    'collector.submitting',
    'collector.invalid_email',
    'collector.success_email',
    'collector.success_instant',
    'collector.already_subscribed',
    'collector.rate_limited',
    'collector.error',
    'collector.download',
  ];
  for (const key of keys) {
    const matches = photosJs.match(new RegExp(`'${key.replace('.', '\\.')}':`, 'g')) || [];
    assert.equal(matches.length, 3, `Expected EN/FR/ES translations for ${key}, found ${matches.length}`);
  }
});

test('collector-note.js validates email, derives page-specific source, submits, and renders wallpapers', async () => {
  const calls = [];
  const env = bootCollectorRuntime({
    source: 'gallery',
    gallery: 'spain',
    lang: 'fr',
    fetchImpl: async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          emailSent: true,
          alreadySubscribed: false,
          wallpapers: [
            { title: 'Nerja Cove', location: 'Andalusia, Spain', dimensions: '3400 × 1327', downloadUrl: 'https://photos-by-elie.com/a.jpg' },
            { title: 'San Gimignano', location: 'Tuscany, Italy', dimensions: '2200 × 1650', downloadUrl: 'https://photos-by-elie.com/b.jpg' },
          ],
        }),
      };
    },
  });

  // Reject invalid email without network call.
  env.emailInput.value = 'not-an-email';
  await env.form.dispatch('submit', { preventDefault() {} });
  assert.equal(calls.length, 0);
  assert.equal(env.status.classList.contains('is-error'), true);
  assert.equal(env.emailInput.focused, true);

  // Valid email posts with gallery-spain source and fr language.
  env.emailInput.value = 'collector@example.com';
  await env.form.dispatch('submit', { preventDefault() {} });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://auth.photos-by-elie.com/newsletter/subscribe');
  assert.deepEqual(calls[0].body, {
    email: 'collector@example.com',
    language: 'fr',
    source: 'gallery-spain',
    website: '',
  });
  assert.equal(env.status.classList.contains('is-success'), true);
  assert.equal(env.packContainer.hidden, false);
  assert.equal(env.packList.children.length, 2);
  assert.equal(env.emailInput.value, '');
  assert.equal(env.form.getAttribute('aria-busy'), 'false');
});

test('collector-note.js handles photo source and 429 rate-limit cleanly', async () => {
  const calls = [];
  const env = bootCollectorRuntime({
    source: 'photo',
    lang: 'es',
    fetchImpl: async (url, options) => {
      calls.push(JSON.parse(options.body));
      return { ok: false, status: 429, json: async () => ({ ok: false, error: 'rate_limited' }) };
    },
  });
  env.emailInput.value = 'fan@example.com';
  await env.form.dispatch('submit', { preventDefault() {} });
  assert.equal(calls[0].source, 'photo');
  assert.equal(calls[0].language, 'es');
  assert.equal(env.status.classList.contains('is-error'), true);
  assert.equal(env.packContainer.hidden, true);
});
