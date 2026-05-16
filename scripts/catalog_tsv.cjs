const fs = require("node:fs");
const childProcess = require("node:child_process");
const path = require("node:path");
const vm = require("node:vm");
const zlib = require("node:zlib");

const CATALOG_DIR = path.join("assets", "catalog");
const COLLECTIONS_TSV = path.join(CATALOG_DIR, "collections.tsv");
const PHOTOS_TSV = path.join(CATALOG_DIR, "photos.tsv");
const PRODUCT_PRICING_JSON = path.join(CATALOG_DIR, "product-pricing.json");
const HELPER_MARKER = "window.photosByElieOriginTypes =";
const PHOTO_BASE_KEYS = new Set([
  "id",
  "className",
  "title",
  "caption",
  "full",
  "megapixels",
  "sourceOrigin",
  "pricingTier",
  "gallerySrc",
  "imageSrc",
  "metadata",
  "media",
  "sourceFiles",
  "keywords",
]);

const collectionColumns = [
  "collection_key",
  "scope",
  "number_json",
  "title",
  "description",
  "accent",
  "extra_json",
];

const photoColumns = [
  "collection_key",
  "scope",
  "sort_index",
  "id",
  "className",
  "title",
  "caption",
  "full",
  "megapixels",
  "sourceOrigin",
  "pricingTier",
  "gallerySrc",
  "imageSrc",
  "metadata_json",
  "media_json",
  "sourceFiles_json",
  "keywords_json",
  "extra_json",
];

const cell = (value) => JSON.stringify(value == null ? "" : String(value));
const parseCell = (value) => {
  if (value == null || value === "") return "";
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};
const jsonCell = (value) => JSON.stringify(value ?? null);
const parseJsonCell = (value, fallback) => {
  const parsed = parseCell(value);
  if (!parsed) return fallback;
  try {
    return JSON.parse(parsed);
  } catch {
    return fallback;
  }
};

const writeTsv = (filePath, columns, rows) => {
  const lines = [columns.join("\t")];
  for (const row of rows) {
    lines.push(columns.map((column) => cell(row[column])).join("\t"));
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`);
  fs.writeFileSync(`${filePath}.gz`, zlib.gzipSync(fs.readFileSync(filePath)));
};

const readTsv = (filePath) => {
  const text = fs.readFileSync(filePath, "utf8");
  const [headerLine, ...lines] = text.split(/\n/).filter((line) => line.length);
  const columns = headerLine.split("\t");
  return lines.map((line) => {
    const values = line.split("\t");
    return Object.fromEntries(columns.map((column, index) => [column, values[index] ?? ""]));
  });
};

const collectionExtra = (collection) => Object.fromEntries(
  Object.entries(collection || {}).filter(([key]) => !["number", "title", "description", "accent", "photos"].includes(key)),
);

const photoExtra = (photo) => Object.fromEntries(
  Object.entries(photo || {}).filter(([key]) => !PHOTO_BASE_KEYS.has(key)),
);

const writeCatalogTsv = (repoRoot, publicCollections, ownerCollections = {}) => {
  const collectionRows = [];
  const photoRows = [];
  const addCollection = (scope, collectionKey, collection) => {
    const safeCollection = collection || {};
    collectionRows.push({
      collection_key: collectionKey,
      scope,
      number_json: jsonCell(safeCollection.number ?? ""),
      title: safeCollection.title || "",
      description: safeCollection.description || "",
      accent: safeCollection.accent || "",
      extra_json: jsonCell(collectionExtra(safeCollection)),
    });
    (safeCollection.photos || []).forEach((photo, index) => {
      photoRows.push({
        collection_key: collectionKey,
        scope,
        sort_index: index,
        id: photo.id || "",
        className: photo.className || "",
        title: photo.title || "",
        caption: photo.caption || "",
        full: photo.full || "",
        megapixels: photo.megapixels ?? "",
        sourceOrigin: photo.sourceOrigin || "",
        pricingTier: photo.pricingTier || "",
        gallerySrc: photo.gallerySrc || "",
        imageSrc: photo.imageSrc || "",
        metadata_json: jsonCell(photo.metadata || []),
        media_json: jsonCell(photo.media || {}),
        sourceFiles_json: jsonCell(photo.sourceFiles || []),
        keywords_json: jsonCell(photo.keywords || []),
        extra_json: jsonCell(photoExtra(photo)),
      });
    });
  };

  Object.entries(publicCollections || {}).forEach(([key, collection]) => addCollection("public", key, collection));
  Object.entries(ownerCollections || {}).forEach(([key, collection]) => addCollection("owner", key, collection));

  const collectionsPath = path.join(repoRoot, COLLECTIONS_TSV);
  const photosPath = path.join(repoRoot, PHOTOS_TSV);
  writeTsv(collectionsPath, collectionColumns, collectionRows);
  writeTsv(photosPath, photoColumns, photoRows);
  return {
    collections: collectionRows.length,
    photos: photoRows.length,
    files: [collectionsPath, `${collectionsPath}.gz`, photosPath, `${photosPath}.gz`],
  };
};

const loadCatalogBundleFromTsv = (repoRoot) => {
  const collectionsPath = path.join(repoRoot, COLLECTIONS_TSV);
  const photosPath = path.join(repoRoot, PHOTOS_TSV);
  if (!fs.existsSync(collectionsPath) || !fs.existsSync(photosPath)) return null;

  const data = {};
  const owner = {};
  const targets = { public: data, owner };
  for (const row of readTsv(collectionsPath)) {
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

  for (const row of readTsv(photosPath)) {
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
  return { data, owner };
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
  const bundle = loadCatalogBundleFromTsv(repoRoot);
  if (!bundle) {
    const dataPath = path.join(repoRoot, "photos-data.js");
    const sandbox = { window: {}, console, Intl };
    applyProductCatalog(sandbox.window, productCatalog);
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(dataPath, "utf8"), sandbox, { filename: dataPath });
    return sandbox.window;
  }
  const sandbox = { window: { photosByElieData: bundle.data, photosByElieOwnerData: bundle.owner }, console, Intl };
  applyProductCatalog(sandbox.window, productCatalog);
  vm.createContext(sandbox);
  vm.runInContext(helperTailFromPhotosData(repoRoot), sandbox, { filename: "photos-data.js#helpers" });
  return sandbox.window;
};

module.exports = {
  COLLECTIONS_TSV,
  PHOTOS_TSV,
  PRODUCT_PRICING_JSON,
  helperTailFromPhotosData,
  loadCatalogBundleFromTsv,
  loadCatalogWindow,
  loadProductCatalog,
  writeCatalogTsv,
};
