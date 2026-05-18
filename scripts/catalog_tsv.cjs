const fs = require("node:fs");
const childProcess = require("node:child_process");
const path = require("node:path");
const vm = require("node:vm");

const CATALOG_DIR = path.join("assets", "catalog");
const PRODUCT_PRICING_JSON = path.join(CATALOG_DIR, "product-pricing.json");
const HELPER_MARKER = "window.photosByElieOriginTypes =";

const loadCatalogBundleFromSqlite = (repoRoot) => {
  const dbPath = path.join(repoRoot, CATALOG_DIR, "photosbyelie.sqlite");
  const decoderPath = path.join(repoRoot, "catalog-sqlite.js");
  if (!fs.existsSync(dbPath) || !fs.existsSync(decoderPath)) return null;
  const decoder = require(decoderPath);
  const bundle = decoder.decodeCatalog(fs.readFileSync(dbPath));
  return {
    data: bundle.data || {},
    owner: bundle.owner || {},
    productCatalog: bundle.productCatalog || null,
  };
};

const loadProductCatalog = (repoRoot) => {
  const pricingPath = path.join(repoRoot, PRODUCT_PRICING_JSON);
  const pricing = JSON.parse(fs.readFileSync(pricingPath, "utf8"));
  const priceTiers = Array.isArray(pricing.priceTiers)
    ? Object.fromEntries(pricing.priceTiers.map((tier) => [tier.id, { label: tier.label }]))
    : (pricing.priceTiers || {});
  const videoPriceTiers = Array.isArray(pricing.videoPriceTiers)
    ? Object.fromEntries(pricing.videoPriceTiers.map((tier) => [tier.id, {
      label: tier.label,
      price: Number(tier.price) || 0,
      minDurationSeconds: Number(tier.minDurationSeconds || 0),
      maxDurationSeconds: tier.maxDurationSeconds == null ? null : Number(tier.maxDurationSeconds),
    }]))
    : (pricing.videoPriceTiers || {});
  return {
    priceTiers,
    resolutions: (pricing.products || pricing.resolutions || []).map((product) => {
      const option = { ...product };
      if (option.price == null && option.prices) {
        option.price = Number(option.prices.original ?? Object.values(option.prices)[0] ?? 0);
      }
      return option;
    }),
    frameOptions: (pricing.frames || pricing.frameOptions || []).map((frame) => ({ ...frame })),
    shippingHandlingPrices: { ...(pricing.shippingHandlingPrices || {}) },
    videoPriceTiers,
  };
};

const applyProductCatalog = (targetWindow, productCatalog) => {
  targetWindow.photosByElieProductCatalog = productCatalog;
  targetWindow.photosByElieResolutions = (productCatalog.resolutions || []).map((product) => ({ ...product }));
  targetWindow.photosByEliePriceTiers = { ...(productCatalog.priceTiers || {}) };
  targetWindow.photosByElieFrameOptions = (productCatalog.frameOptions || []).map((frame) => ({ ...frame }));
  targetWindow.photosByElieShippingHandlingPrices = { ...(productCatalog.shippingHandlingPrices || {}) };
  targetWindow.photosByElieVideoPriceTiers = { ...(productCatalog.videoPriceTiers || {}) };
};

const loadCatalogWindowFromPhotosData = (repoRoot) => {
  const dataPath = path.join(repoRoot, "photos-data.js");
  const sandbox = { window: {}, console, Intl };
  applyProductCatalog(sandbox.window, loadProductCatalog(repoRoot));
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(dataPath, "utf8"), sandbox, { filename: dataPath });
  return sandbox.window;
};

const helperTailFromPhotosData = (repoRoot) => {
  const dataPath = path.join(repoRoot, "photos-data.js");
  const source = fs.existsSync(dataPath) ? fs.readFileSync(dataPath, "utf8") : "";
  const markerIndex = source.indexOf(HELPER_MARKER);
  if (markerIndex !== -1) return source.slice(markerIndex);
  try {
    const committed = childProcess.execFileSync("git", ["show", "HEAD:photos-data.js"], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const committedMarkerIndex = committed.indexOf(HELPER_MARKER);
    if (committedMarkerIndex !== -1) return committed.slice(committedMarkerIndex);
  } catch {}
  const resolutionMarker = "window.photosByElieResolutions =";
  const resolutionIndex = source.indexOf(resolutionMarker);
  if (resolutionIndex === -1) {
    throw new Error(`Could not find helper marker in ${dataPath}`);
  }
  return source.slice(resolutionIndex);
};

const loadCatalogWindow = (repoRoot) => {
  const productCatalog = loadProductCatalog(repoRoot);
  const bundle = loadCatalogBundleFromSqlite(repoRoot);
  if (!bundle) {
    return loadCatalogWindowFromPhotosData(repoRoot);
  }
  const sandbox = { window: { photosByElieData: bundle.data, photosByElieOwnerData: bundle.owner }, console, Intl };
  applyProductCatalog(sandbox.window, productCatalog);
  vm.createContext(sandbox);
  vm.runInContext(helperTailFromPhotosData(repoRoot), sandbox, { filename: "photos-data.js#helpers" });
  return sandbox.window;
};

module.exports = {
  PRODUCT_PRICING_JSON,
  helperTailFromPhotosData,
  loadCatalogBundleFromSqlite,
  loadCatalogWindowFromPhotosData,
  loadCatalogWindow,
  loadProductCatalog,
};
