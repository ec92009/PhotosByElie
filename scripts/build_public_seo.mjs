#!/usr/bin/env node
/** Generate a flat static SEO overlay; never write catalog or Owner state. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const marker = '.pbe-seo-generated';
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c]);
const safeJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

/** Reuse PBE-18's actual text and schema helpers, without executing site code. */
export function loadSeo(repoRoot, window = {}) {
  const source = fs.readFileSync(path.join(repoRoot, 'photos.js'), 'utf8');
  const block = source.match(/window\.photosByElieSeo = \(\(\) => \{[\s\S]*?\n\}\)\(\);/);
  if (!block) throw new Error('Public SEO helper boundary is missing');
  const context = { window, URL };
  vm.runInNewContext(block[0], context, { timeout: 1000 });
  return context.window.photosByElieSeo;
}

/** Replace one required existing tag; fail if the shell contract has changed. */
function replaceRequired(html, pattern, replacement) {
  if (!pattern.test(html)) throw new Error(`SEO shell contract missing: ${pattern}`);
  return html.replace(pattern, replacement);
}

/** Keep the complete customer shell, settings and lifecycle-gated hydration. */
export function renderEntity(template, entity) {
  const { title, description, url, image, imageAlt, jsonLd, kind, key, body } = entity;
  let html = replaceRequired(template, /<title>[\s\S]*?<\/title>/, () => `<title>${escapeHtml(title)}</title>`);
  html = replaceRequired(html, /<link rel="canonical"[^>]*\/>/, () => `<link rel="canonical" href="${escapeHtml(url)}"/>`);
  const meta = {
    description, 'og:title': title, 'og:description': description, 'og:url': url,
    'og:image': image, 'og:image:alt': imageAlt,
    'twitter:title': title, 'twitter:description': description, 'twitter:image': image,
  };
  for (const [name, value] of Object.entries(meta)) {
    const attr = name.startsWith('og:') ? 'property' : 'name';
    html = replaceRequired(html, new RegExp(`<meta ${attr}="${name}"[^>]*\\/>`),
      () => `<meta ${attr}="${name}" content="${escapeHtml(value)}"/>`);
  }
  html = html.replace('</head>', () => `<script type="application/ld+json" id="photosbyelie-page-jsonld">${safeJson(jsonLd)}</script>\n</head>`);
  const dataAttr = kind === 'photo' ? 'data-photo-id' : 'data-gallery';
  html = replaceRequired(html, /<body([^>]*)>/, (_, attrs) => {
    // Existing gallery shells already carry data-gallery="". Duplicate HTML
    // attributes retain the first value and would hydrate the wrong collection.
    const remaining = attrs.replace(new RegExp(`\\s${dataAttr}=(?:"[^"]*"|'[^']*')`, 'gi'), '');
    return `<body${remaining} ${dataAttr}="${escapeHtml(key)}">`;
  });
  return replaceRequired(html, /<main\b[^>]*>/, (main) =>
    `${main}\n<noscript><section class="panel"><h1>${escapeHtml(imageAlt)}</h1><p>${escapeHtml(description)}</p>${body}</section></noscript>`);
}

/** Read only vetted public columns, then apply the existing commerce policy. */
export function publicEntities(repoRoot, catalog, seo) {
  const rows = JSON.parse(execFileSync(process.env.PYTHON || 'python3',
    [path.join(root, 'scripts/read_public_seo_catalog.py'), catalog], {
      encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    }));
  const pricing = JSON.parse(fs.readFileSync(path.join(repoRoot, 'assets/catalog/product-pricing.json'), 'utf8'));
  if (pricing.schema !== 'photosbyelie.product-pricing.v1' || !pricing.storefrontPolicy) throw new Error('Missing storefront policy');
  const policy = pricing.storefrontPolicy;
  for (const name of ['retiredCollectionKeys', 'retiredSourceOrigins', 'retiredMediaTypes']) {
    if (!Array.isArray(policy[name])) throw new Error(`Missing storefront policy ${name}`);
  }
  const retired = (name, value) => policy[name].some((item) => String(item).toLowerCase() === value.toLowerCase());
  const photos = rows.filter((row) => !retired('retiredCollectionKeys', row.collectionKey)
    && row.collectionKey.toLowerCase() !== 'ai' && !retired('retiredSourceOrigins', 'camera')
    && !retired('retiredMediaTypes', 'photo'));
  if (!photos.length) throw new Error('Refusing to generate an empty SEO catalog');
  const ids = new Set();
  for (const photo of photos) {
    if (!seo.entityPath('photo', photo.id) || !seo.entityPath('gallery', photo.collectionKey)) throw new Error('Unsafe SEO entity identifier');
    if (ids.has(photo.id.toLowerCase())) throw new Error('Duplicate SEO photo identifier');
    ids.add(photo.id.toLowerCase());
  }
  return photos;
}

/** Build into a new staging directory and replace only our marked prior output. */
export function build({ repoRoot = root, output = path.join(root, 'tmp/public-seo'), catalog = path.join(repoRoot, 'assets/catalog/photosbyelie.sqlite') } = {}) {
  repoRoot = path.resolve(repoRoot);
  output = path.resolve(output);
  if (fs.existsSync(output) && (!fs.existsSync(path.join(output, marker)) || fs.lstatSync(output).isSymbolicLink())) {
    throw new Error('Refusing to replace an unmarked SEO output directory');
  }
  const catalogSha256 = crypto.createHash('sha256').update(fs.readFileSync(catalog)).digest('hex');
  const seo = loadSeo(repoRoot);
  const photos = publicEntities(repoRoot, catalog, seo);
  const photoTemplate = fs.readFileSync(path.join(repoRoot, 'photo.html'), 'utf8');
  const galleryTemplate = fs.readFileSync(path.join(repoRoot, 'gallery.html'), 'utf8');
  const mediaConfig = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(repoRoot, 'media-config.js'), 'utf8'), mediaConfig, { timeout: 1000 });
  const previewBase = new URL(mediaConfig.window.photosByElieMediaConfig.publicBaseUrl);
  if (previewBase.protocol !== 'https:' || previewBase.username || previewBase.password || previewBase.search || previewBase.hash) throw new Error('Unsafe public preview base');
  const imageFor = (photo) => `${previewBase.href.replace(/\/$/, '')}/expo/${photo.id}_900.jpg`;
  const entityUrl = (kind, key) => seo.siteOrigin + seo.entityPath(kind, key);
  const groups = new Map();
  for (const photo of photos) {
    if (!groups.has(photo.collectionKey)) groups.set(photo.collectionKey, []);
    groups.get(photo.collectionKey).push(photo);
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const stage = fs.mkdtempSync(path.join(path.dirname(output), '.seo-stage-'));
  try {
    fs.writeFileSync(path.join(stage, marker), 'photosbyelie.public-seo.v1\n');
    const urls = ['/', '/gallery.html', '/support.html', '/privacy.html', '/terms.html', '/data-deletion.html']
      .filter((route) => fs.existsSync(path.join(repoRoot, route === '/' ? 'index.html' : route.slice(1))))
      .map((route) => seo.siteOrigin + route);
    const emit = (entity, template) => {
      fs.writeFileSync(path.join(stage, seo.entityPath(entity.kind, entity.key).slice(1)), renderEntity(template, entity));
      urls.push(entity.url);
    };
    for (const photo of photos) {
      const name = seo.cleanPublicText(photo.title);
      const collection = seo.cleanPublicText(photo.collectionTitle);
      const description = seo.cleanPublicText(photo.description || `${name} from the ${collection} gallery by Photos By Elie.`);
      const url = entityUrl('photo', photo.id);
      const image = imageFor(photo);
      emit({ kind: 'photo', key: photo.id, title: `Photos By Elie | ${name}`, description, url, image, imageAlt: name,
        jsonLd: seo.imageObjectJsonLd({ name, description, url, image, collectionName: collection }),
        body: `<p><a href="./photo.html?id=${escapeHtml(photo.id)}">${escapeHtml(name)}</a> · <a href="${entityUrl('gallery', photo.collectionKey)}">${escapeHtml(collection)}</a></p>`,
      }, photoTemplate);
    }
    for (const [key, items] of groups) {
      const name = `${seo.cleanPublicText(items[0].collectionTitle)} Gallery`;
      // DB collection descriptions contain archive workflow notes; use PBE-18's public fallback.
      const description = `Browse ${seo.cleanPublicText(items[0].collectionTitle)} travel photography and digital wall-art downloads by Photos By Elie.`;
      const url = entityUrl('gallery', key);
      const image = imageFor(items[0]);
      emit({ kind: 'gallery', key, title: `Photos By Elie | ${name}`, description, url, image, imageAlt: name,
        jsonLd: seo.collectionPageJsonLd({ name, description, url, image, photos: items.slice(0, 12).map((photo) => ({ image: imageFor(photo) })) }),
        body: `<p><a href="./gallery.html?gallery=${escapeHtml(key)}">${escapeHtml(name)}</a></p><ul>${items.map((photo) => `<li><a href="${entityUrl('photo', photo.id)}">${escapeHtml(seo.cleanPublicText(photo.title))}</a></li>`).join('')}</ul>`,
      }, galleryTemplate);
    }
    fs.writeFileSync(path.join(stage, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((url) => `  <url><loc>${escapeHtml(url)}</loc></url>`).join('\n')}\n</urlset>\n`);
    fs.copyFileSync(path.join(repoRoot, 'robots.txt'), path.join(stage, 'robots.txt'));
    if (crypto.createHash('sha256').update(fs.readFileSync(catalog)).digest('hex') !== catalogSha256) {
      throw new Error('Public catalog changed during SEO generation; output was not replaced');
    }
    if (fs.existsSync(output)) fs.rmSync(output, { recursive: true });
    fs.renameSync(stage, output);
    return { photos: photos.length, galleries: groups.size, urls: urls.length,
      catalogSha256, output };
  } catch (error) {
    fs.rmSync(stage, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const config = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = { '--repo-root': 'repoRoot', '--output': 'output', '--catalog': 'catalog' }[args[index]];
    if (!key || !args[index + 1]) throw new Error('Usage: build_public_seo.mjs [--repo-root PATH] [--output PATH] [--catalog PATH]');
    config[key] = args[index + 1];
  }
  console.log(JSON.stringify(build(config)));
}
