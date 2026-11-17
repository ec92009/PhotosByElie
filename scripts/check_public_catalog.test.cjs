const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { checkCatalogGeneration } = require("./check_public_catalog.cjs");

const generation = {
  schemaVersion: 1,
  path: "./assets/catalog/photosbyelie.sqlite",
  bytes: 16,
  sha256: "catalog-checksum",
  pricing: { path: "./assets/catalog/product-pricing.json", bytes: 20, sha256: "pricing-checksum" },
};

const withBootstrap = (source, run) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pbe-artifact-generation-"));
  try {
    fs.writeFileSync(path.join(root, "photos-data.js"), source);
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};
const bootstrap = (value) => `const catalogGeneration = Object.freeze(${JSON.stringify(value)});\nwindow.photosByElieCatalogGeneration = catalogGeneration;`;

test("artifact generation check supports the baseline reader before integration", () => {
  withBootstrap("// Baseline catalog bootstrap", (root) => {
    assert.equal(checkCatalogGeneration(root, undefined), null);
  });
});

test("artifact generation check accepts the matching catalogGenerationFor contract", () => {
  withBootstrap(bootstrap(generation), (root) => {
    const reader = (repoRoot) => {
      assert.equal(repoRoot, root);
      return generation;
    };
    assert.deepEqual(checkCatalogGeneration(root, reader), generation);
  });
});

test("artifact generation check rejects missing integration halves", () => {
  withBootstrap("// Baseline catalog bootstrap", (root) => {
    assert.throws(() => checkCatalogGeneration(root, () => generation), /regenerate/);
  });
  withBootstrap(bootstrap(generation), (root) => {
    assert.throws(() => checkCatalogGeneration(root, undefined), /requires its catalog reader/);
  });
});

test("artifact generation check rejects mixed catalog and pricing generations", () => {
  for (const value of [
    { ...generation, sha256: "stale-catalog" },
    { ...generation, bytes: generation.bytes + 1 },
    { ...generation, pricing: { ...generation.pricing, sha256: "stale-pricing" } },
    { ...generation, pricing: { ...generation.pricing, bytes: generation.pricing.bytes + 1 } },
  ]) {
    withBootstrap(bootstrap(value), (root) => {
      assert.throws(() => checkCatalogGeneration(root, () => generation), /one exact generation/);
    });
  }
});
