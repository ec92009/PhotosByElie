#!/usr/bin/env node
// Exercise the shipped SQLite decoder and pricing through the existing reader.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  catalogGenerationFor,
  loadCatalogBundleFromSqlite,
  loadProductCatalog,
} = require("./catalog_tsv.cjs");

const checkCatalogGeneration = (site, generationFor) => {
  const bootstrap = fs.readFileSync(path.join(site, "photos-data.js"), "utf8");
  const binding = bootstrap.match(/const catalogGeneration\s*=\s*Object\.freeze\((\{[^\n]*\})\);/);
  if (typeof generationFor !== "function") {
    assert.doesNotMatch(
      bootstrap,
      /photosByElieCatalogGeneration/,
      "generation-bound bootstrap requires its catalog reader",
    );
    return null;
  }
  assert.ok(binding, "regenerate the catalog bootstrap with --bootstrap-only before staging");
  const generation = JSON.parse(binding[1]);
  assert.deepEqual(
    generation,
    generationFor(site),
    "bootstrap, public SQLite, and pricing must share one exact generation",
  );
  return generation;
};

const main = () => {
  const site = path.resolve(process.argv[2] || "tmp/public-release/site");
  const generation = checkCatalogGeneration(site, catalogGenerationFor);
  const { data, productCatalog } = loadCatalogBundleFromSqlite(site);
  const expectedPricing = loadProductCatalog(site);
  const photos = Object.values(data).flatMap((collection) => collection.photos || []);
  assert.ok(photos.length > 0, "shipped decoder must produce public media");
  assert.equal(new Set(photos.map((photo) => photo.id)).size, photos.length, "media IDs must be unique");
  for (const option of productCatalog.resolutions) {
    const expected = expectedPricing.resolutions.find((item) => item.id === option.id);
    assert.ok(expected, `unknown public product ${option.id}`);
    for (const field of ["type", "price", "prices", "minMegapixels"]) {
      assert.deepEqual(option[field], expected[field], `${option.id} ${field} differs from public pricing`);
    }
  }
  assert.equal(productCatalog.resolutions.length, expectedPricing.resolutions.length);

  let scripts = 0;
  for (const file of fs.readdirSync(site, { recursive: true })) {
    if (!/\.(?:js|mjs)$/.test(file)) continue;
    execFileSync(process.execPath, ["--check", path.join(site, file)], { stdio: "pipe" });
    scripts += 1;
  }
  console.log(JSON.stringify({
    decodedMedia: photos.length,
    products: productCatalog.resolutions.length,
    syntaxCheckedScripts: scripts,
    catalogGeneration: generation,
  }));
};

module.exports = { checkCatalogGeneration };
if (require.main === module) {
  if (process.argv[2] === "--generation-only") {
    checkCatalogGeneration(path.resolve(process.argv[3]), catalogGenerationFor);
  } else {
    main();
  }
}
