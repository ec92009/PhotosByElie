#!/usr/bin/env node
const fs = require("node:fs");
const childProcess = require("node:child_process");
const path = require("node:path");
const {
  GENERATED_HELPER_MARKER,
  helperTailFromPhotosData,
  loadCatalogBundleFromSqlite,
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
    window.photosByElieStorefrontPolicy = { ...(catalog.storefrontPolicy || {}) };
    window.photosByElieResolutions = normalizeProducts(products);
    window.photosByEliePriceTiers = normalizePriceTiers(catalog.priceTiers || {});
    window.photosByElieFrameOptions = (catalog.frameOptions || catalog.frames || []).map((frame) => ({ ...frame }));
    window.photosByElieShippingHandlingPrices = { ...(catalog.shippingHandlingPrices || {}) };
    window.photosByElieVideoPriceTiers = normalizeVideoPriceTiers(catalog.videoPriceTiers || {});
    window.photosByEliePodAutomation = { ...(catalog.podAutomation || {}) };
    window.photosByEliePodSuppliers = (catalog.podSuppliers || []).map((supplier) => ({ ...supplier }));
    window.photosByEliePodQualityTiers = (catalog.podQualityTiers || []).map((tier) => ({ ...tier }));
    window.photosByEliePodOptions = (catalog.podOptions || []).map((option) => ({ ...option }));
  };

  const finishCatalogLoad = (source, data, owner, productCatalog) => {
    const existingData = window.photosByElieData || {};
    window.photosByElieData = { ...(data || {}), ...existingData };
    window.photosByElieOwnerData = owner || {};
    const canonicalCatalog = readJson("./assets/catalog/product-pricing.json");
    applyProductCatalog({ ...canonicalCatalog, ...(productCatalog || {}), storefrontPolicy: canonicalCatalog.storefrontPolicy || {} });
    window.photosByElieCatalogSource = source;
    window.photosByElieApplyCollectionOrigins?.(window.photosByElieData);
    window.photosByElieApplyCollectionOrigins?.(window.photosByElieOwnerData);
    window.photosByElieApplyStorefrontPolicy?.(window.photosByElieData);
    window.dispatchEvent?.(new CustomEvent("photosbyelie:catalogready", { detail: { source } }));
    return window.photosByElieData;
  };
  window.photosByElieData = window.photosByElieData || {};
  window.photosByElieOwnerData = window.photosByElieOwnerData || {};
  window.photosByElieCatalogReady = (async () => {
    if (window.photosByElieCatalogSqlite?.decodeCatalog) {
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
      "// Generated bootstrap: loads the plain SQLite catalog.",
      runtimeParser,
      GENERATED_HELPER_MARKER,
      tail.trimEnd(),
      "",
    ].join("\n"),
  );
};

const writeHomeData = () => {
  const bundle = loadCatalogBundleFromSqlite(repoRoot);
  const payload = Object.fromEntries(
    Object.entries(bundle?.data || {}).map(([slug, collection]) => [slug, {
      number: collection.number || "",
      title: collection.title || slug,
      description: collection.description || "",
      accent: collection.accent || `${slug}-gallery`,
      count: (collection.photos || []).length,
      href: `./gallery.html?gallery=${slug}`,
      photos: (collection.photos || []).slice(0, 4).map((photo) => ({
        id: photo.id,
        title: photo.title,
        gallerySrc: photo.gallerySrc || "",
        imageSrc: photo.imageSrc || "",
        media: photo.media || {},
      })),
    }])
  );
  fs.writeFileSync(
    path.join(repoRoot, "home-data.js"),
    `window.photosByElieHomeData = ${JSON.stringify(payload, null, 2)};\n` +
      "window.photosByElieApplyStorefrontPolicy?.(window.photosByElieHomeData);\n"
  );
};

const hasFullGeneratedCatalog = () => {
  if (!fs.existsSync(dataPath)) return false;
  const source = fs.readFileSync(dataPath, "utf8");
  return source.includes("window.photosByElieData = {") && !source.startsWith("// Generated bootstrap:");
};

const buildSqlite = (source = "auto", { commerceOnly = false } = {}) => {
  const args = ["scripts/build_public_catalog_db.py", "--quiet"];
  if (commerceOnly) args.push("--commerce-only");
  if (source === "photos-data") args.push("--source", "photos-data");
  childProcess.execFileSync("python3", args, { cwd: repoRoot, stdio: "inherit" });
};

const commerceOnly = process.argv.includes("--commerce-only");
const bootstrapOnly = process.argv.includes("--bootstrap-only");
if (bootstrapOnly) {
  writeHomeData();
  writeBootstrap();
} else if (commerceOnly) {
  buildSqlite("auto", { commerceOnly: true });
  writeHomeData();
  writeBootstrap();
} else if (hasFullGeneratedCatalog()) {
  buildSqlite("photos-data");
  writeHomeData();
  writeBootstrap();
} else {
  buildSqlite();
  writeHomeData();
  writeBootstrap();
}
console.log("Wrote assets/catalog/photosbyelie.sqlite");
