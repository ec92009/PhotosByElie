#!/usr/bin/env node
const fs = require("node:fs");
const childProcess = require("node:child_process");
const path = require("node:path");
const {
  helperTailFromPhotosData,
} = require("./catalog_tsv.cjs");

const repoRoot = path.resolve(__dirname, "..");
const dataPath = path.join(repoRoot, "photos-data.js");

const runtimeParser = `(() => {
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
  const readBinaryAsync = async (relativePath) => {
    const script = document.currentScript;
    const scriptUrl = script?.src ? new URL(script.src, window.location.href) : null;
    const version = scriptUrl?.searchParams.get("v") || document.querySelector(".brand")?.textContent?.match(/v([0-9.]+)/)?.[1] || "";
    const url = new URL(relativePath, scriptUrl || window.location.href);
    if (version) url.searchParams.set("v", version);
    const response = await fetch(url.href, { cache: "default" });
    if (!response.ok) throw new Error(\`Could not load \${relativePath}: HTTP \${response.status}\`);
    return new Uint8Array(await response.arrayBuffer());
  };
  const brotliDecompress = async (bytes) => {
    const sqliteHeader = [83, 81, 76, 105, 116, 101, 32, 102, 111, 114, 109, 97, 116, 32, 51, 0];
    if (sqliteHeader.every((value, index) => bytes[index] === value)) return bytes;
    if (typeof DecompressionStream !== "function") throw new Error("Brotli decompression is not supported.");
    let stream;
    try {
      stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("brotli"));
    } catch {
      throw new Error("Brotli decompression is not supported.");
    }
    return new Uint8Array(await new Response(stream).arrayBuffer());
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

  const finishCatalogLoad = (source, data, owner, productCatalog) => {
    const existingData = window.photosByElieData || {};
    window.photosByElieData = { ...(data || {}), ...existingData };
    window.photosByElieOwnerData = owner || {};
    applyProductCatalog(productCatalog || readJson("./assets/catalog/product-pricing.json"));
    window.photosByElieCatalogSource = source;
    window.photosByElieApplyCollectionOrigins?.(window.photosByElieData);
    window.photosByElieApplyCollectionOrigins?.(window.photosByElieOwnerData);
    window.dispatchEvent?.(new CustomEvent("photosbyelie:catalogready", { detail: { source } }));
    return window.photosByElieData;
  };
  window.photosByElieData = window.photosByElieData || {};
  window.photosByElieOwnerData = window.photosByElieOwnerData || {};
  window.photosByElieCatalogReady = (async () => {
    if (window.photosByElieCatalogSqlite?.decodeCatalog) {
      try {
        const compressed = await readBinaryAsync("./assets/catalog/photosbyelie.sqlite.br");
        const bundle = window.photosByElieCatalogSqlite.decodeCatalog(await brotliDecompress(compressed));
        return finishCatalogLoad("sqlite-br", bundle.data, bundle.owner, bundle.productCatalog);
      } catch (error) {
        if (!String(error?.message || "").includes("Brotli decompression is not supported")) {
          console.warn(error?.message || "Brotli SQLite catalog load failed; trying plain SQLite.");
        }
      }
      try {
        const bundle = window.photosByElieCatalogSqlite.decodeCatalog(readBinary("./assets/catalog/photosbyelie.sqlite"));
        return finishCatalogLoad("sqlite", bundle.data, bundle.owner, bundle.productCatalog);
      } catch (error) {
        console.warn(error?.message || "SQLite catalog load failed.");
      }
    }
    throw new Error("Could not load public SQLite catalog.");
  })();
})();`;

const writeBootstrap = () => {
  const tail = helperTailFromPhotosData(repoRoot);
  fs.writeFileSync(
    dataPath,
    [
      "// Generated bootstrap: attempts Brotli-compressed SQLite, then falls back to plain SQLite.",
      runtimeParser,
      tail.trimEnd(),
      "",
    ].join("\n"),
  );
};

writeBootstrap();
childProcess.execFileSync("python3", ["scripts/build_public_catalog_db.py", "--quiet"], { cwd: repoRoot, stdio: "inherit" });
console.log("Wrote assets/catalog/photosbyelie.sqlite");
