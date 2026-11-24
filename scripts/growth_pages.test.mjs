import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const GUIDES = [
  { file: 'guide-andalusia-wall-art.html', source: 'guide-andalusia', country: 'spain' },
  { file: 'guide-paris-fine-art-prints.html', source: 'guide-paris', country: 'france' },
  { file: 'guide-california-coastal-photography.html', source: 'guide-california', country: 'usa' },
  { file: 'guide-tuscany-wall-art.html', source: 'guide-tuscany', country: 'italy' },
];

test('#4 social.html provides bio-link hub, platform filter toolbar, real og:image, and Collector Note', () => {
  const html = fs.readFileSync(path.join(root, 'social.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'campaigns.js'), 'utf8');

  assert.match(html, /class="social-hub-strip"/);
  assert.match(html, /data-campaign-filters/);
  assert.match(html, /property="og:image" content="https:\/\/photos-by-elie\.com\/assets\/gallery-heroes\/spain\.jpg"/);
  assert.match(html, /id="collector-note" data-collector-source="social"/);
  assert.match(html, /collector-note\.js\?v=321\.13/);
  assert.match(html, /data-wst-pbe-funnel="true"/);
  assert.match(js, /renderSourceFilters/);
  assert.match(js, /applySourceFilter/);
});

test('#5 curated destination wall-art guides are valid, allowlisted, linked to print options, and in sitemap generator', () => {
  const policy = JSON.parse(fs.readFileSync(path.join(root, 'scripts/public-artifact-files.json'), 'utf8'));
  const seoBuilder = fs.readFileSync(path.join(root, 'scripts/build_public_seo.mjs'), 'utf8');

  assert.ok(policy.files.includes('guides.css'), 'guides.css must be allowlisted');
  for (const guide of GUIDES) {
    assert.ok(policy.pages.includes(guide.file), `${guide.file} must be in policy.pages`);
    assert.ok(policy.files.includes(guide.file), `${guide.file} must be in policy.files`);
    assert.ok(seoBuilder.includes(`'/${guide.file}'`), `${guide.file} must be listed in build_public_seo.mjs sitemapEntries`);

    const html = fs.readFileSync(path.join(root, guide.file), 'utf8');
    assert.match(html, new RegExp(`<link rel="canonical" href="https://photos-by-elie\\.com/${guide.file}"/>`));
    assert.match(html, /"@type":"CollectionPage"/);
    assert.match(html, /"@type":"ItemList"/);
    assert.match(html, /option=jpg-6mp/);
    assert.match(html, new RegExp(`data-collector-source="${guide.source}"`));
    assert.match(html, new RegExp(`gallery\\.html\\?gallery=${guide.country}`));
    assert.match(html, /collector-note\.js\?v=321\.13/);
  }
});

test('#6 property-photography.html includes Costa del Sol local SEO, FAQ JSON-LD, ES/EN toggle, and analytics', () => {
  const html = fs.readFileSync(path.join(root, 'property-photography.html'), 'utf8');

  for (const city of ['Alhaurín de la Torre', 'Málaga', 'Marbella', 'Mijas', 'Fuengirola', 'Benalmádena', 'Nerja']) {
    assert.ok(html.includes(city), `property-photography.html should mention ${city}`);
  }
  assert.match(html, /"@type":"ProfessionalService"/);
  assert.match(html, /"@type":"FAQPage"/);
  assert.match(html, /"postalCode":"29130"/);
  assert.match(html, /data-lang-btn="es"/);
  assert.match(html, /data-lang-btn="en"/);
  assert.match(html, /analytics\.js\?v=321\.13" data-wst-pbe-funnel="true"/);
});
