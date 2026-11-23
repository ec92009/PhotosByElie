import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build, loadSeo } from './build_public_seo.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function fixture(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'pbe-seo-test-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  fs.mkdirSync(path.join(folder, 'assets/catalog'), { recursive: true });
  for (const file of ['photos.js', 'photo.html', 'gallery.html', 'media-config.js', 'robots.txt',
    'index.html', 'support.html', 'privacy.html', 'terms.html', 'data-deletion.html', 'assets/catalog/product-pricing.json']) {
    fs.copyFileSync(path.join(root, file), path.join(folder, file));
  }
  const catalog = path.join(folder, 'assets/catalog/photosbyelie.sqlite');
  execFileSync(process.env.PYTHON || 'python3', ['-c', `
import sqlite3,sys
c=sqlite3.connect(sys.argv[1])
c.executescript('''
CREATE TABLE collections(collection_id,slug,title,scope,sort_order);
CREATE TABLE media_items(media_id,title,description,collection_id,source_origin_id,media_type_id,sort_index);
CREATE TABLE source_origins(source_origin_id,code);
CREATE TABLE media_types(media_type_id,code);
CREATE TABLE media_assets(media_id,asset_type_id,width,height);
CREATE TABLE asset_types(asset_type_id,code);
INSERT INTO collections VALUES(1,'france','France','public',1),(2,'private','Secret collection','private',2),
(3,'owner','Owner collection','owner',3),(4,'ai','AI','public',4),(5,'retired','Retired','public',5),
(6,'unknown','Unknown scope',NULL,6);
INSERT INTO source_origins VALUES(1,'camera'),(2,'ai'),(3,'unknown');
INSERT INTO media_types VALUES(1,'photo'),(2,'video');
INSERT INTO asset_types VALUES(1,'still_900'),(2,'full');
''')
for key,col,origin,kind,preview in [('good',1,1,1,1),('second',1,1,1,1),('private',2,1,1,1),
('owner',3,1,1,1),('ai-collection',4,1,1,1),('ai-origin',1,2,1,1),('unknown-origin',1,3,1,1),
('retired',5,1,1,1),('video',1,1,2,1),('missing-preview',1,1,1,0),('unknown-scope',6,1,1,1)]:
 c.execute('INSERT INTO media_items VALUES(?,?,?,?,?,?,?)',(key,'A <tower> & "view" </script>',None,col,origin,kind,1))
 c.execute('INSERT INTO media_assets VALUES(?,?,?,?)',(key,1 if preview else 2,900,600))
c.commit()
`, catalog]);
  const pricing = JSON.parse(fs.readFileSync(path.join(folder, 'assets/catalog/product-pricing.json')));
  pricing.storefrontPolicy.retiredCollectionKeys.push('retired');
  fs.writeFileSync(path.join(folder, 'assets/catalog/product-pricing.json'), JSON.stringify(pricing));
  return { folder, catalog, output: path.join(folder, 'output') };
}

test('static HTTP metadata, sitemap and no-JS links contain only eligible public camera photos', async (t) => {
  const f = fixture(t);
  const before = sha(f.catalog);
  const result = build({ repoRoot: f.folder, catalog: f.catalog, output: f.output });
  assert.equal(result.photos, 2);
  assert.equal(result.galleries, 1);
  assert.equal(result.catalogSha256, before);
  assert.equal(sha(f.catalog), before);
  assert.ok(!fs.existsSync(`${f.catalog}-wal`));
  assert.ok(!fs.existsSync(path.join(f.folder, 'assets/owner-actions')));
  const sitemap = fs.readFileSync(path.join(f.output, 'sitemap.xml'), 'utf8');
  assert.doesNotMatch(sitemap, /github|lastmod|private|retired|ai-|video|missing-preview|unknown|owner/);
  const routes = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => new URL(match[1]).pathname);
  assert.equal(routes.length, 9);
  for (const route of routes) {
    const file = route === '/' ? 'index.html' : route.slice(1);
    assert.ok(fs.existsSync(path.join(f.output, file)) || fs.existsSync(path.join(f.folder, file)), route);
  }
  const server = http.createServer((req, res) => {
    const route = new URL(req.url, 'http://localhost').pathname.slice(1);
    res.setHeader('Content-Type', 'text/html');
    res.end(fs.readFileSync(path.join(f.output, route), 'utf8'));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  for (const route of ['photo--good.html', 'gallery--france.html']) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/${route}`);
    const html = await response.text();
    assert.equal(response.status, 200);
    const bodyTag = html.match(/<body[^>]*>/)[0];
    const identityAttr = route.startsWith('gallery') ? 'data-gallery' : 'data-photo-id';
    const identity = route.startsWith('gallery') ? 'france' : 'good';
    assert.equal((bodyTag.match(new RegExp(identityAttr + '=', 'g')) || []).length, 1);
    assert.ok(bodyTag.includes(`${identityAttr}="${identity}"`));
    assert.match(html, new RegExp(`<link rel="canonical" href="https://photos-by-elie.com/${route}"`));
    assert.match(html, /<meta property="og:image" content="https:\/\/download.photos-by-elie.com\/media\/expo\/good_900.jpg"/);
    assert.match(html, /<meta name="twitter:image"/);
    assert.match(html, /<noscript>.*<h1>/);
    assert.doesNotMatch(html, /<img[^>]+expo\//); // No media before lifecycle authority.
    assert.equal((html.match(/id="photosbyelie-page-jsonld"/g) || []).length, 1);
    const json = JSON.parse(html.match(/id="photosbyelie-page-jsonld">(.*?)<\/script>/)[1]);
    assert.equal(json.url, `https://photos-by-elie.com/${route}`);
    const version = fs.readFileSync(path.join(root, 'photo.html'), 'utf8').match(/photos.js\?v=([^"\s]+)/)[1];
    assert.ok(html.includes(`photos.js?v=${version}`)); // Release identity comes from the existing shell.
  }
  const photo = fs.readFileSync(path.join(f.output, 'photo--good.html'), 'utf8');
  assert.match(photo, /data-photo-id="good"/);
  assert.match(photo, /A &lt;tower&gt; &amp; &quot;view&quot; &lt;\/script&gt;/);
  assert.match(photo, /photo.html\?id=good/);
  const gallery = fs.readFileSync(path.join(f.output, 'gallery--france.html'), 'utf8');
  assert.match(gallery, /data-gallery="france"/);
  assert.match(gallery, /photo--second.html/);
  const first = sha(path.join(f.output, 'sitemap.xml'));
  fs.writeFileSync(path.join(f.output, 'photo--obsolete.html'), 'stale');
  build({ repoRoot: f.folder, catalog: f.catalog, output: f.output });
  assert.equal(sha(path.join(f.output, 'sitemap.xml')), first);
  assert.ok(!fs.existsSync(path.join(f.output, 'photo--obsolete.html')));
});

test('generation fails closed and preserves prior output for invalid input or policy', (t) => {
  const f = fixture(t);
  build({ repoRoot: f.folder, catalog: f.catalog, output: f.output });
  const before = sha(path.join(f.output, 'sitemap.xml'));
  fs.writeFileSync(`${f.catalog}-wal`, 'not checkpointed');
  assert.throws(() => build({ repoRoot: f.folder, catalog: f.catalog, output: f.output }), /checkpointed/);
  fs.rmSync(`${f.catalog}-wal`);
  fs.writeFileSync(path.join(f.folder, 'assets/catalog/product-pricing.json'), '{}');
  assert.throws(() => build({ repoRoot: f.folder, catalog: f.catalog, output: f.output }), /policy/);
  assert.equal(sha(path.join(f.output, 'sitemap.xml')), before);
  assert.throws(() => build({ repoRoot: f.folder, output: f.folder }), /unmarked/);
});

test('existing PBE-18 canonical helper maps eligible entities and retains utility/query routes', () => {
  const good = { id: 'good', sourceOrigin: 'camera', media: { type: 'photo', publicPreview: { allowed: true } } };
  const context = { photosByElieData: { france: { photos: [good] }, ai: { photos: [good] },
    shared: { photos: [{ ...good, id: 'private' }] } },
    photosByElieCollectionIsRetired: (key) => key === 'ai', photosByElieStorefrontAllowsPhoto: () => true };
  const seo = loadSeo(root, context);
  assert.equal(seo.pageUrl('/photo.html', { id: 'good' }), 'https://photos-by-elie.com/photo--good.html');
  assert.equal(seo.pageUrl('/gallery.html', { gallery: 'france' }), 'https://photos-by-elie.com/gallery--france.html');
  for (const gallery of ['ai', 'shared', 'selection', 'missing']) {
    assert.equal(seo.pageUrl('/gallery.html', { gallery }), `https://photos-by-elie.com/gallery.html?gallery=${gallery}`);
  }
  assert.equal(seo.pageUrl('/photo.html', { id: 'private' }), 'https://photos-by-elie.com/photo.html?id=private');
  context.photosByElieStorefrontAllowsPhoto = () => false;
  assert.equal(seo.pageUrl('/photo.html', { id: 'good' }), 'https://photos-by-elie.com/photo.html?id=good');
  assert.equal(seo.entityPath('photo', '../escape'), '');
});

test('enriches SEO metadata with location, keywords, licensable JSON-LD, image sitemap, and visible-ID filtering', (t) => {
  const f = fixture(t);
  execFileSync(process.env.PYTHON || 'python3', ['-c', `
import sqlite3,sys
c=sqlite3.connect(sys.argv[1])
c.execute('ALTER TABLE media_items ADD COLUMN location TEXT')
c.execute('ALTER TABLE media_items ADD COLUMN keyword_ids TEXT')
c.execute('CREATE TABLE keyword_terms(keyword_id INTEGER PRIMARY KEY, keyword TEXT)')
c.executemany('INSERT INTO keyword_terms VALUES(?,?)', [(1,'eiffel tower'),(2,'paris'),(3,'sunset')])
c.execute('UPDATE media_items SET location=?, keyword_ids=? WHERE media_id=?', ('Paris, France', '1,2,3', 'good'))
c.commit()
`, f.catalog]);

  const visibleFile = path.join(f.folder, 'visible.json');
  fs.writeFileSync(visibleFile, JSON.stringify({ ok: true, visibleMediaIds: ['good'] }));
  const result = build({ repoRoot: f.folder, catalog: f.catalog, output: f.output, visibleIdsFile: visibleFile });
  assert.equal(result.photos, 1);
  assert.equal(result.galleries, 1);
  assert.ok(fs.existsSync(path.join(f.output, 'photo--good.html')));
  assert.ok(!fs.existsSync(path.join(f.output, 'photo--second.html')));

  const photoHtml = fs.readFileSync(path.join(f.output, 'photo--good.html'), 'utf8');
  assert.match(photoHtml, /Paris, France/);
  assert.match(photoHtml, /eiffel tower, paris, sunset/);
  const jsonLd = JSON.parse(photoHtml.match(/id="photosbyelie-page-jsonld">(.*?)<\/script>/)[1]);
  assert.equal(jsonLd.acquireLicensePage, 'https://photos-by-elie.com/photo--good.html');
  assert.equal(jsonLd.license, 'https://photos-by-elie.com/support.html');
  assert.equal(jsonLd.copyrightNotice, '© Photos By Elie');
  assert.deepEqual(jsonLd.contentLocation, { '@type': 'Place', name: 'Paris, France' });
  assert.equal(jsonLd.keywords, 'eiffel tower, paris, sunset');

  const sitemap = fs.readFileSync(path.join(f.output, 'sitemap.xml'), 'utf8');
  assert.match(sitemap, /xmlns:image="http:\/\/www\.google\.com\/schemas\/sitemap-image\/1\.1"/);
  assert.match(sitemap, /<image:loc>https:\/\/download\.photos-by-elie\.com\/media\/expo\/good_900\.jpg<\/image:loc>/);
  assert.doesNotMatch(sitemap, /photo--second\.html/);

  const emptyVisible = path.join(f.folder, 'empty-visible.json');
  fs.writeFileSync(emptyVisible, JSON.stringify({ ok: true, visibleMediaIds: [] }));
  assert.throws(() => build({ repoRoot: f.folder, catalog: f.catalog, output: f.output, visibleIdsFile: emptyVisible }), /no media IDs/);
});
