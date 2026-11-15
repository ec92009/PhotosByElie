#!/usr/bin/env node
const fs = require("node:fs");
const childProcess = require("node:child_process");
const path = require("node:path");
const {
  GENERATED_HELPER_MARKER,
  catalogGenerationFor,
  helperTailFromPhotosData,
  loadCatalogBundleFromSqlite,
} = require("./catalog_tsv.cjs");

const repoRoot = path.resolve(__dirname, "..");
const dataPath = path.join(repoRoot, "photos-data.js");

const runtimeParser = `(() => {
  const catalogGeneration = Object.freeze(__CATALOG_GENERATION__);
  Object.freeze(catalogGeneration.pricing);
  window.photosByElieCatalogGeneration = catalogGeneration;
  // Capture once: currentScript is null after an asynchronous boundary.
  const script = document.currentScript;
  const scriptUrl = script?.src ? new URL(script.src, window.location.href) : null;
  const version = scriptUrl?.searchParams.get("v") || document.querySelector(".brand")?.textContent?.match(/v([0-9.]+)/)?.[1] || "";
  const assetUrl = (relativePath) => {
    const url = new URL(relativePath, scriptUrl || window.location.href);
    if (version) url.searchParams.set("v", version);
    return url;
  };
  const clock = () => Number(window.performance?.now?.() ?? Date.now());
  const timings = window.photosByElieCatalogTimings = {
    schemaVersion: 1,
    generation: catalogGeneration.sha256,
    pricingGeneration: catalogGeneration.pricing.sha256,
    state: "loading",
    startedAt: clock(),
  };
  window.performance?.mark?.("pbe:catalog:start");
  const duration = (startedAt) => Math.max(0, clock() - startedAt);
  const hexDigest = (bytes) => [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  const verifyCatalogGeneration = async (bytes, generation) => {
    if (bytes.byteLength !== generation.bytes) {
      throw new Error("Catalog generation size does not match its bootstrap.");
    }
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw new Error("Catalog checksum verification is unavailable.");
    const digest = await subtle.digest("SHA-256", bytes);
    if (hexDigest(new Uint8Array(digest)) !== generation.sha256) {
      throw new Error("Catalog generation checksum does not match its bootstrap.");
    }
  };
  const readBinary = async (generation, timingPrefix = "") => {
    const url = assetUrl(generation.path);
    const startedAt = clock();
    const response = await fetch(url.href, { cache: "default", credentials: "same-origin" });
    if (!response.ok) throw new Error(\`Could not load \${generation.path}: HTTP \${response.status}\`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    timings[timingPrefix ? "pricingDownloadMs" : "downloadMs"] = duration(startedAt);
    timings[timingPrefix ? "pricingDownloadBytes" : "downloadBytes"] = bytes.byteLength;
    const verifyStartedAt = clock();
    await verifyCatalogGeneration(bytes, generation);
    timings[timingPrefix ? "pricingChecksumMs" : "checksumMs"] = duration(verifyStartedAt);
    timings[timingPrefix ? "pricingChecksumVerified" : "checksumVerified"] = true;
    return bytes;
  };
  const readJson = async (generation) => {
    const bytes = await readBinary(generation, "pricing");
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
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

  const lifecycleWorkerBase = () => {
    const config = window.photosByElieMediaConfig || {};
    return String(config.authWorkerBaseUrl || config.checkoutWorkerBaseUrl || "").trim().replace(/\\/+$/, "");
  };

  const publicPhotos = (data = {}) => Object.values(data)
    .flatMap((collection) => Array.isArray(collection?.photos) ? collection.photos : []);

  const requestedDetailPhotoId = () => {
    const pathname = String(window.location.pathname || "");
    const generatedRoute = /\\/photo--[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}\\.html$/.test(pathname);
    if (!pathname.endsWith("/photo.html") && !generatedRoute) return "";
    const queryId = new URLSearchParams(window.location.search || "").get("id");
    return String(queryId || (generatedRoute ? document.body?.dataset?.photoId : "") || "").trim();
  };

  const lifecycleCandidateIds = (data = {}) => {
    const detailPhotoId = requestedDetailPhotoId();
    if (detailPhotoId) return [detailPhotoId];
    return [...new Set(publicPhotos(data).map((photo) => String(photo?.id || "").trim()).filter(Boolean))];
  };

  const isLocalhost = () => /^(localhost|127\\.0\\.0\\.1)$/i.test(window.location.hostname);
  const lifecycleBatchSize = 100;
  const lifecycleMaxConcurrency = 6;
  let lifecycleVisibleIds = null;
  let catalogPhotosById = new Map();
  const pendingCollections = {};

  const lifecycleSafePhoto = (photo) => {
    const id = String(photo?.id || "").trim();
    if (!id || !lifecycleVisibleIds?.has(id) || !catalogPhotosById.has(id)) return null;
    // Contexts select catalog identities; their stale metadata/keys are not authority.
    photo = catalogPhotosById.get(id);
    const media = photo?.media && typeof photo.media === "object" ? { ...photo.media } : {};
    const preview = media.publicPreview && typeof media.publicPreview === "object"
      ? { ...media.publicPreview }
      : {};
    [
      "detailUrl", "galleryUrl", "posterUrl", "previewUrl", "thumbnailUrl", "videoUrl",
    ].forEach((key) => delete preview[key]);
    const video = media.video && typeof media.video === "object" ? { ...media.video } : null;
    if (video) {
      ["posterUrl", "previewUrl", "publicPreviewUrl", "url", "videoUrl"].forEach((key) => delete video[key]);
    }
    return {
      ...photo,
      gallerySrc: "",
      imageSrc: "",
      media: { ...media, publicPreview: preview, ...(video ? { video } : {}) },
    };
  };

  const lifecycleSafeCollection = (collection = {}) => {
    const sanitizePhotos = (photos) => (Array.isArray(photos) ? photos : [])
      .map(lifecycleSafePhoto)
      .filter(Boolean);
    const photosTarget = sanitizePhotos(collection?.photos);
    const photos = new Proxy(photosTarget, {
      get(target, key, receiver) {
        if (key === "push" || key === "unshift") {
          return (...items) => Array.prototype[key].apply(target, sanitizePhotos(items));
        }
        if (key === "splice") {
          return (start, deleteCount, ...items) => Array.prototype.splice.call(
            target, start, deleteCount, ...sanitizePhotos(items),
          );
        }
        return Reflect.get(target, key, receiver);
      },
      set(target, key, value) {
        if (key === "length") return Reflect.set(target, key, value);
        const safe = lifecycleSafePhoto(value);
        return safe ? Reflect.set(target, key, safe) : true;
      },
    });
    const target = { ...collection, count: photos.length, photos };
    return new Proxy(target, {
      set(current, key, value) {
        if (key === "photos") {
          photos.splice(0, photos.length, ...sanitizePhotos(value));
          current.count = photos.length;
          return true;
        }
        return Reflect.set(current, key, value);
      },
    });
  };

  const installLifecycleGuardedCatalog = (data = {}) => {
    if (isLocalhost()) {
      timings.lifecycleMode = "localhost-bypass";
      window.photosByElieData = data;
      return data;
    }
    const target = {};
    const guarded = new Proxy(target, {
      set(collections, key, collection) {
        if (typeof key === "symbol") return Reflect.set(collections, key, collection);
        if (lifecycleVisibleIds === null) pendingCollections[key] = collection;
        return Reflect.set(collections, key, lifecycleSafeCollection(collection));
      },
      defineProperty(collections, key, descriptor) {
        if (typeof key === "symbol") return Reflect.defineProperty(collections, key, descriptor);
        if (lifecycleVisibleIds === null) pendingCollections[key] = descriptor.value;
        return Reflect.defineProperty(collections, key, {
          ...descriptor,
          value: lifecycleSafeCollection(descriptor.value),
        });
      },
    });
    const replace = (next) => {
      if (next === guarded) return;
      Object.keys(target).forEach((key) => delete target[key]);
      if (lifecycleVisibleIds === null) Object.keys(pendingCollections).forEach((key) => delete pendingCollections[key]);
      Object.entries(next && typeof next === "object" ? next : {}).forEach(([key, collection]) => {
        guarded[key] = collection;
      });
    };
    Object.defineProperty(window, "photosByElieData", {
      configurable: true,
      enumerable: true,
      get: () => guarded,
      set: replace,
    });
    replace(data);
    return guarded;
  };

  const applyLifecycleVisibility = async (data = {}) => {
    if (isLocalhost()) {
      timings.lifecycleMs = 0;
      timings.lifecycleBatchCount = 0;
      timings.lifecycleConcurrency = 0;
      return data;
    }
    const startedAt = clock();
    timings.lifecycleMode = "authority";
    const base = lifecycleWorkerBase();
    const ids = lifecycleCandidateIds(data).filter((id) => catalogPhotosById.has(id));
    if (!base) throw new Error("Lifecycle visibility authority is unavailable.");
    const visibleIds = new Set();
    const batches = [];
    for (let index = 0; index < ids.length; index += lifecycleBatchSize) {
      batches.push(ids.slice(index, index + lifecycleBatchSize));
    }
    let cursor = 0;
    let stopped = false;
    const controller = new AbortController();
    const authorizeNext = async () => {
      if (stopped) return;
      const batchIndex = cursor;
      cursor += 1;
      if (batchIndex >= batches.length) return;
      const requestedIds = new Set(batches[batchIndex]);
      const response = await fetch(\`\${base}/lifecycle/visibility\`, {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mediaIds: batches[batchIndex] }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(\`Lifecycle visibility failed with HTTP \${response.status}.\`);
      const payload = await response.json();
      if (!Array.isArray(payload?.visibleMediaIds)) throw new Error("Lifecycle visibility response is malformed.");
      payload.visibleMediaIds.forEach((id) => {
        if (typeof id !== "string" || !requestedIds.has(id)) throw new Error("Lifecycle visibility response contains an unknown media ID.");
        visibleIds.add(id);
      });
      await authorizeNext();
    };
    const concurrency = Math.min(lifecycleMaxConcurrency, batches.length);
    timings.lifecycleBatchCount = batches.length;
    timings.lifecycleConcurrency = concurrency;
    try {
      await Promise.all(Array.from({ length: concurrency }, () => authorizeNext()));
    } catch (error) {
      stopped = true;
      controller.abort();
      throw error;
    } finally {
      timings.lifecycleMs = duration(startedAt);
    }
    lifecycleVisibleIds = visibleIds;
    return Object.fromEntries(Object.entries(data).map(([key, collection]) => [key, {
      ...collection,
      photos: (collection?.photos || []).filter((photo) => visibleIds.has(photo?.id)),
    }]));
  };

  const finishCatalogLoad = async (source, data, owner, productCatalog) => {
    catalogPhotosById = new Map(publicPhotos(data).map((photo) => [photo.id, photo]));
    const canonicalCatalog = await readJson(catalogGeneration.pricing);
    applyProductCatalog({ ...canonicalCatalog, ...(productCatalog || {}), storefrontPolicy: canonicalCatalog.storefrontPolicy || {} });
    const filteredData = await applyLifecycleVisibility(data);
    const contexts = isLocalhost() ? window.photosByElieData : pendingCollections;
    installLifecycleGuardedCatalog({ ...(contexts || {}), ...filteredData });
    Object.keys(pendingCollections).forEach((key) => delete pendingCollections[key]);
    window.photosByElieOwnerData = owner || {};
    window.photosByElieCatalogSource = source;
    window.photosByElieApplyCollectionOrigins?.(window.photosByElieData);
    window.photosByElieApplyCollectionOrigins?.(window.photosByElieOwnerData);
    window.photosByElieApplyStorefrontPolicy?.(window.photosByElieData);
    timings.state = "ready";
    timings.readyMs = duration(timings.startedAt);
    window.performance?.mark?.("pbe:catalog:ready");
    window.performance?.measure?.("pbe:catalog:startup", "pbe:catalog:start", "pbe:catalog:ready");
    window.dispatchEvent?.(new CustomEvent("photosbyelie:catalogready", { detail: { source, timings: { ...timings } } }));
    return window.photosByElieData;
  };
  installLifecycleGuardedCatalog(window.photosByElieData || {});
  window.photosByElieOwnerData = window.photosByElieOwnerData || {};
  window.photosByElieCatalogReady = (async () => {
    if (window.photosByElieCatalogSqlite?.decodeCatalog) {
      try {
        const bytes = await readBinary(catalogGeneration);
        const decodeStartedAt = clock();
        const bundle = window.photosByElieCatalogSqlite.decodeCatalog(bytes);
        timings.decodeMs = duration(decodeStartedAt);
        Object.assign(timings, bundle.timings || {});
        return await finishCatalogLoad("sqlite", bundle.data, bundle.owner, bundle.productCatalog);
      } catch (error) {
        console.warn(error?.message || "SQLite catalog load failed.");
      }
    }
    timings.state = "failed";
    timings.failedAtMs = duration(timings.startedAt);
    lifecycleVisibleIds = new Set();
    installLifecycleGuardedCatalog({});
    window.photosByElieCatalogSource = "lifecycle-denied";
    throw new Error("Could not load a lifecycle-authorized public catalog.");
  })();
})();`;

const writeBootstrap = () => {
  const tail = helperTailFromPhotosData(repoRoot);
  const parser = runtimeParser
    .replace("__CATALOG_GENERATION__", JSON.stringify(catalogGenerationFor(repoRoot)));
  fs.writeFileSync(
    dataPath,
    [
      "// Generated bootstrap: loads the plain SQLite catalog.",
      parser,
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
console.log(bootstrapOnly ? "Wrote public catalog bootstrap and home projection (SQLite unchanged)." : "Wrote assets/catalog/photosbyelie.sqlite");
