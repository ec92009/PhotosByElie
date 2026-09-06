import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const code = readFileSync(new URL('../analytics.js', import.meta.url), 'utf8');
function run({ origin = 'https://photos-by-elie.com', pathname = '/', gpc = false, dnt = '', preview = false } = {}) {
  const scripts = [];
  const window = { location: { origin, pathname }, photosByElieMonitoringPreview: preview };
  const document = { createElement: () => ({ dataset: {} }), body: { append: script => scripts.push(script) } };
  vm.runInNewContext(code, { window, document, navigator: { globalPrivacyControl: gpc, doNotTrack: dnt }, Set });
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
test('order URLs expose no query or payment identifiers in configuration', () => {
  const { scripts } = run({ pathname: '/order.html' });
  scripts[0].onload();
  assert.equal(Object.keys(scripts[1].dataset).length, 6);
  assert.doesNotMatch(JSON.stringify(scripts), /session_id|order_id|buyerEmail/);
});
