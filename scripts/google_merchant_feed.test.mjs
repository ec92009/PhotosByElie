import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { selectMerchantProducts, renderMerchantXml } from "./build_google_merchant_feed.mjs";
import { loadSeo } from "./build_public_seo.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function makeMerchantFixture(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "pbe-merchant-test-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  fs.mkdirSync(path.join(folder, "assets/catalog"), { recursive: true });
  for (const file of ["photos.js", "assets/catalog/product-pricing.json"]) {
    fs.copyFileSync(path.join(root, file), path.join(folder, file));
  }
  const catalog = path.join(folder, "assets/catalog/photosbyelie.sqlite");
  execFileSync(process.env.PYTHON || "python3", ["-c", `
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
c.executescript('''
CREATE TABLE collections(collection_id, slug, title, scope, sort_order);
CREATE TABLE media_items(media_id, title, description, location, keyword_ids, collection_id, source_origin_id, media_type_id, sort_index);
CREATE TABLE keyword_terms(keyword_id INTEGER PRIMARY KEY, keyword TEXT);
CREATE TABLE source_origins(source_origin_id, code);
CREATE TABLE media_types(media_type_id, code);
CREATE TABLE media_assets(media_id, asset_type_id, width, height);
CREATE TABLE asset_types(asset_type_id, code);
INSERT INTO collections VALUES (1, 'spain', 'Spain', 'public', 1), (2, 'france', 'France', 'public', 2);
INSERT INTO source_origins VALUES (1, 'camera');
INSERT INTO media_types VALUES (1, 'photo');
INSERT INTO asset_types VALUES (1, 'still_900'), (2, 'full');
INSERT INTO keyword_terms VALUES (1, 'courtyard'), (2, 'arches'), (3, 'sunset');
''')
items = [
  ('spain-curated-1', 'Alhambra Courtyard Light', None, 'Granada, Spain', '1,2', 1, 4000, 6000),
  ('france-highres-1', 'Louvre Pyramid at Dusk', None, 'Paris, France', '2,3', 2, 6000, 4000),
  ('spain-lowres-1', 'Small Crop Photo', None, 'Seville, Spain', '1', 1, 2000, 1500),
  ('spain-revoked-1', 'Hidden Photo', None, 'Ronda, Spain', '1', 1, 6000, 4000),
]
for mid, title, desc, loc, kw, col, fw, fh in items:
  c.execute('INSERT INTO media_items VALUES(?,?,?,?,?,?,1,1,1)', (mid, title, desc, loc, kw, col))
  c.execute('INSERT INTO media_assets VALUES(?,1,900,600)', (mid,))
  c.execute('INSERT INTO media_assets VALUES(?,2,?,?)', (mid, fw, fh))
c.commit()
`, catalog]);

  const manifestPath = path.join(folder, "socials/Pinterest/2026-07-11/granada/manifest.json");
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify({
    date: "2026-07-11",
    title: "Alhambra Courtyard Light",
    board_recommendation: "Spain Travel Photography",
    description: "Warm evening light across carved arches in Granada.",
    items: [
      { id: "spain-curated-1", title: "Alhambra Courtyard Light", collection: "spain", width: 1200, height: 1800 },
    ],
  }, null, 2));

  return folder;
}

test("Google Merchant feed fails closed on empty visibility and enforces live pricing & megapixel eligibility", (t) => {
  const folder = makeMerchantFixture(t);
  assert.throws(() => selectMerchantProducts({ repoRoot: folder, visibleSet: new Set() }), /visibleSet/);

  const visible = new Set(["spain-curated-1", "france-highres-1", "spain-lowres-1"]);
  const items = selectMerchantProducts({ repoRoot: folder, visibleSet: visible, optionId: "jpg-6mp", maxItems: 50 });

  // spain-lowres-1 is 3 MP (< 6 MP minMegapixels for jpg-6mp) and spain-revoked-1 is not visible
  assert.deepEqual(items.map((item) => item.mediaId), ["spain-curated-1", "france-highres-1"]);
  assert.equal(items[0].id, "pbe-spain-curated-1-jpg-6mp");
  assert.equal(items[0].price, "28.00 USD");
  assert.equal(items[0].link, "https://photos-by-elie.com/photo--spain-curated-1.html?option=jpg-6mp");
  assert.equal(items[0].imageLink, "https://download.photos-by-elie.com/media/expo/spain-curated-1_1800.jpg");
  assert.equal(items[0].orientation, "Portrait");
  assert.equal(items[0].tier, "Curated");
  assert.equal(items[1].orientation, "Landscape");
  assert.equal(items[1].tier, "Catalog");

  const xml = renderMerchantXml(items, { asOf: "2026-11-24" });
  assert.match(xml, /xmlns:g="http:\/\/base\.google\.com\/ns\/1\.0"/);
  assert.match(xml, /<g:id>pbe-spain-curated-1-jpg-6mp<\/g:id>/);
  assert.match(xml, /<g:price>28\.00 USD<\/g:price>/);
  assert.match(xml, /<g:google_product_category>500044<\/g:google_product_category>/);
  assert.match(xml, /<g:identifier_exists>no<\/g:identifier_exists>/);
  assert.match(xml, /<g:shipping><g:country>US<\/g:country><g:service>Instant Digital Download<\/g:service><g:price>0\.00 USD<\/g:price><\/g:shipping>/);
  assert.doesNotMatch(xml, /spain-revoked-1/);
  assert.doesNotMatch(xml, /spain-lowres-1/);
});

test("window.photosByElieSeo.productJsonLd emits single Offer for ?option=<id> and AggregateOffer otherwise", () => {
  const seo = loadSeo(root);
  const offers = [
    { id: "jpg-1mp", label: "JPG 1 MP", price: 8 },
    { id: "jpg-6mp", label: "JPG 6 MP", price: 28 },
    { id: "full", label: "Full resolution", price: 65 },
  ];
  const agg = seo.productJsonLd({
    id: "abc-123",
    name: "Seville Courtyard",
    description: "Fine art photo",
    url: "https://photos-by-elie.com/photo--abc-123.html",
    image: "https://download.photos-by-elie.com/media/expo/abc-123_900.jpg",
    currency: "usd",
    offers,
  });
  assert.equal(agg["@type"], "Product");
  assert.equal(agg.offers["@type"], "AggregateOffer");
  assert.equal(agg.offers.lowPrice, "8.00");
  assert.equal(agg.offers.highPrice, "65.00");
  assert.equal(agg.offers.offerCount, 3);

  const single = seo.productJsonLd({
    id: "abc-123",
    name: "Seville Courtyard",
    description: "Fine art photo",
    url: "https://photos-by-elie.com/photo--abc-123.html",
    image: "https://download.photos-by-elie.com/media/expo/abc-123_900.jpg",
    currency: "usd",
    offers,
    selectedOptionId: "jpg-6mp",
  });
  assert.equal(single.sku, "pbe-abc-123-jpg-6mp");
  assert.equal(single.offers["@type"], "Offer");
  assert.equal(single.offers.price, "28.00");
  assert.equal(single.offers.priceCurrency, "USD");
  assert.equal(single.offers.url, "https://photos-by-elie.com/photo--abc-123.html?option=jpg-6mp");
});
