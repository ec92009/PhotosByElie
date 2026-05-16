#!/usr/bin/env node
const fs = require("node:fs");
const childProcess = require("node:child_process");
const path = require("node:path");
const vm = require("node:vm");
const {
  COLLECTIONS_TSV,
  PHOTOS_TSV,
  helperTailFromPhotosData,
  loadCatalogBundleFromTsv,
  writeCatalogTsv,
} = require("./catalog_tsv.cjs");

const repoRoot = path.resolve(__dirname, "..");
const dataPath = path.join(repoRoot, "photos-data.js");

const loadFromPhotosData = () => {
  const sandbox = { window: {}, console, Intl };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(dataPath, "utf8"), sandbox, { filename: dataPath });
  return {
    data: sandbox.window.photosByElieData || {},
    owner: sandbox.window.photosByElieOwnerData || {},
  };
};

const runtimeParser = `(() => {
  const parseCell = (value) => {
    if (value == null || value === "") return "";
    try { return JSON.parse(value); } catch { return value; }
  };
  const parseJsonCell = (value, fallback) => {
    const parsed = parseCell(value);
    if (!parsed) return fallback;
    try { return JSON.parse(parsed); } catch { return fallback; }
  };
  const readTsv = (relativePath) => {
    const script = document.currentScript;
    const scriptUrl = script?.src ? new URL(script.src, window.location.href) : null;
    const version = scriptUrl?.searchParams.get("v") || document.querySelector(".brand")?.textContent?.match(/v([0-9.]+)/)?.[1] || "";
    const url = new URL(relativePath, scriptUrl || window.location.href);
    if (version) url.searchParams.set("v", version);
    const request = new XMLHttpRequest();
    request.open("GET", url.href, false);
    request.overrideMimeType?.("text/plain; charset=utf-8");
    request.send(null);
    if (request.status && (request.status < 200 || request.status >= 300)) {
      throw new Error(\`Could not load \${relativePath}: HTTP \${request.status}\`);
    }
    const [headerLine, ...lines] = request.responseText.split(/\\n/).filter((line) => line.length);
    const columns = headerLine.split("\\t");
    return lines.map((line) => {
      const values = line.split("\\t");
      return Object.fromEntries(columns.map((column, index) => [column, values[index] ?? ""]));
    });
  };
  const readBinary = (relativePath) => {
    const script = document.currentScript;
    const scriptUrl = script?.src ? new URL(script.src, window.location.href) : null;
    const version = scriptUrl?.searchParams.get("v") || document.querySelector(".brand")?.textContent?.match(/v([0-9.]+)/)?.[1] || "";
    const url = new URL(relativePath, scriptUrl || window.location.href);
    if (version) url.searchParams.set("v", version);
    const request = new XMLHttpRequest();
    request.open("GET", url.href, false);
    request.overrideMimeType?.("text/plain; charset=x-user-defined");
    request.send(null);
    if (request.status && (request.status < 200 || request.status >= 300)) {
      throw new Error(\`Could not load \${relativePath}: HTTP \${request.status}\`);
    }
    const response = request.responseText || "";
    const bytes = new Uint8Array(response.length);
    for (let index = 0; index < response.length; index += 1) bytes[index] = response.charCodeAt(index) & 0xff;
    return bytes;
  };
  const readJson = (relativePath, fallback = {}) => {
    try {
      const script = document.currentScript;
      const scriptUrl = script?.src ? new URL(script.src, window.location.href) : null;
      const version = scriptUrl?.searchParams.get("v") || document.querySelector(".brand")?.textContent?.match(/v([0-9.]+)/)?.[1] || "";
      const url = new URL(relativePath, scriptUrl || window.location.href);
      if (version) url.searchParams.set("v", version);
      const request = new XMLHttpRequest();
      request.open("GET", url.href, false);
      request.overrideMimeType?.("application/json; charset=utf-8");
      request.send(null);
      if (request.status && (request.status < 200 || request.status >= 300)) return fallback;
      return JSON.parse(request.responseText || "{}");
    } catch {
      return fallback;
    }
  };
  const normalizePriceTiers = (priceTiers = {}) => Array.isArray(priceTiers)
    ? Object.fromEntries(priceTiers.map((tier) => [tier.id, { label: tier.label }]))
    : priceTiers;
  const normalizeVideoPriceTiers = (videoPriceTiers = {}) => Array.isArray(videoPriceTiers)
    ? Object.fromEntries(videoPriceTiers.map((tier) => [tier.id, {
      label: tier.label,
      price: Number(tier.price) || 0,
      minDurationSeconds: Number(tier.minDurationSeconds || 0),
      maxDurationSeconds: tier.maxDurationSeconds == null ? null : Number(tier.maxDurationSeconds),
    }]))
    : videoPriceTiers;
  const normalizeProducts = (products = []) => products.map((product) => {
    const option = { ...product };
    if (option.price == null && option.prices) {
      option.price = Number(option.prices.original ?? Object.values(option.prices)[0] ?? 0);
    }
    return option;
  });
  const applyProductCatalog = (catalog = {}) => {
    const products = catalog.resolutions || catalog.products || [];
    window.photosByElieProductCatalog = catalog;
    window.photosByElieResolutions = normalizeProducts(products);
    window.photosByEliePriceTiers = normalizePriceTiers(catalog.priceTiers || {});
    window.photosByElieFrameOptions = (catalog.frameOptions || catalog.frames || []).map((frame) => ({ ...frame }));
    window.photosByElieShippingHandlingPrices = { ...(catalog.shippingHandlingPrices || {}) };
    window.photosByElieVideoPriceTiers = normalizeVideoPriceTiers(catalog.videoPriceTiers || {});
  };

  if (window.photosByElieCatalogSqlite?.decodeCatalog) {
    try {
      const bundle = window.photosByElieCatalogSqlite.decodeCatalog(readBinary("./assets/catalog/photosbyelie.sqlite"));
      window.photosByElieData = bundle.data || {};
      window.photosByElieOwnerData = bundle.owner || {};
      applyProductCatalog(bundle.productCatalog || readJson("./assets/catalog/product-pricing.json"));
      window.photosByElieCatalogSource = "sqlite";
      return;
    } catch (error) {
      console.warn(error?.message || "SQLite catalog load failed; falling back to TSV.");
    }
  }

  const data = {};
  const owner = {};
  const targets = { public: data, owner };
  for (const row of readTsv("./${COLLECTIONS_TSV}")) {
    const scope = parseCell(row.scope) || "public";
    const key = parseCell(row.collection_key);
    if (!key) continue;
    const extra = parseJsonCell(row.extra_json, {});
    targets[scope] = targets[scope] || {};
    targets[scope][key] = {
      ...extra,
      number: parseJsonCell(row.number_json, ""),
      title: parseCell(row.title),
      description: parseCell(row.description),
      accent: parseCell(row.accent),
      photos: [],
    };
  }

  for (const row of readTsv("./${PHOTOS_TSV}")) {
    const scope = parseCell(row.scope) || "public";
    const key = parseCell(row.collection_key);
    const target = targets[scope]?.[key];
    if (!target) continue;
    target.photos.push({
      ...parseJsonCell(row.extra_json, {}),
      id: parseCell(row.id),
      className: parseCell(row.className),
      title: parseCell(row.title),
      caption: parseCell(row.caption),
      full: parseCell(row.full),
      megapixels: Number(parseCell(row.megapixels)) || 0,
      sourceOrigin: parseCell(row.sourceOrigin),
      pricingTier: parseCell(row.pricingTier),
      gallerySrc: parseCell(row.gallerySrc),
      imageSrc: parseCell(row.imageSrc),
      metadata: parseJsonCell(row.metadata_json, []),
      media: parseJsonCell(row.media_json, {}),
      sourceFiles: parseJsonCell(row.sourceFiles_json, []),
      keywords: parseJsonCell(row.keywords_json, []),
    });
  }

  window.photosByElieData = data;
  window.photosByElieOwnerData = owner;
  applyProductCatalog(readJson("./assets/catalog/product-pricing.json"));
  window.photosByElieCatalogSource = "tsv";
})();`;

const writeBootstrap = () => {
  const tail = helperTailFromPhotosData(repoRoot);
  fs.writeFileSync(
    dataPath,
    [
      "// Generated bootstrap: loads the public catalog from SQLite, with TSV fallback.",
      runtimeParser,
      tail.trimEnd(),
      "",
    ].join("\n"),
  );
};

let bundle;
try {
  bundle = loadFromPhotosData();
} catch (error) {
  bundle = loadCatalogBundleFromTsv(repoRoot);
  if (!bundle) throw error;
}

const result = writeCatalogTsv(repoRoot, bundle.data, bundle.owner);
writeBootstrap();
childProcess.execFileSync("python3", ["scripts/build_public_catalog_db.py", "--quiet"], { cwd: repoRoot, stdio: "inherit" });
console.log(`Wrote ${path.relative(repoRoot, path.join(repoRoot, COLLECTIONS_TSV))}`);
console.log(`Wrote ${path.relative(repoRoot, path.join(repoRoot, PHOTOS_TSV))}`);
console.log("Wrote assets/catalog/photosbyelie.sqlite");
console.log(`Collections: ${result.collections}`);
console.log(`Photos: ${result.photos}`);
