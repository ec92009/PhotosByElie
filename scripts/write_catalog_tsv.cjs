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

  const lifecycleWorkerBase = () => {
    const config = window.photosByElieMediaConfig || {};
    return String(config.authWorkerBaseUrl || config.checkoutWorkerBaseUrl || "").trim().replace(/\\/+$/, "");
  };

  const publicPhotos = (data = {}) => Object.values(data)
    .flatMap((collection) => Array.isArray(collection?.photos) ? collection.photos : []);

  const requestedDetailPhotoId = () => {
    if (!String(window.location.pathname || "").endsWith("/photo.html")) return "";
    return String(new URLSearchParams(window.location.search || "").get("id") || "").trim();
  };

  const lifecycleCandidateIds = (data = {}) => {
    const detailPhotoId = requestedDetailPhotoId();
    if (detailPhotoId) return [detailPhotoId];
    return [...new Set(publicPhotos(data).map((photo) => String(photo?.id || "").trim()).filter(Boolean))];
  };

  const isLocalhost = () => /^(localhost|127\\.0\\.0\\.1)$/i.test(window.location.hostname);
  let lifecycleVisibleIds = null;

  const lifecycleSafePhoto = (photo) => {
    const id = String(photo?.id || "").trim();
    if (!id || !lifecycleVisibleIds?.has(id)) return null;
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
      window.photosByElieData = data;
      return data;
    }
    const target = {};
    const guarded = new Proxy(target, {
      set(collections, key, collection) {
        if (typeof key === "symbol") return Reflect.set(collections, key, collection);
        return Reflect.set(collections, key, lifecycleSafeCollection(collection));
      },
      defineProperty(collections, key, descriptor) {
        if (typeof key === "symbol") return Reflect.defineProperty(collections, key, descriptor);
        return Reflect.defineProperty(collections, key, {
          ...descriptor,
          value: lifecycleSafeCollection(descriptor.value),
        });
      },
    });
    const replace = (next) => {
      if (next === guarded) return;
      Object.keys(target).forEach((key) => delete target[key]);
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
    if (isLocalhost()) return data;
    const base = lifecycleWorkerBase();
    const ids = lifecycleCandidateIds(data);
    const requestedIds = new Set(ids);
    if (!base || !ids.length) throw new Error("Lifecycle visibility authority is unavailable.");
    const visibleIds = new Set();
    for (let index = 0; index < ids.length; index += 100) {
      const response = await fetch(\`\${base}/lifecycle/visibility\`, {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mediaIds: ids.slice(index, index + 100) }),
      });
      if (!response.ok) throw new Error(\`Lifecycle visibility failed with HTTP \${response.status}.\`);
      const payload = await response.json();
      (payload.visibleMediaIds || []).forEach((id) => {
        const normalized = String(id || "").trim();
        if (!requestedIds.has(normalized)) throw new Error("Lifecycle visibility response contains an unknown media ID.");
        visibleIds.add(normalized);
      });
    }
    lifecycleVisibleIds = visibleIds;
    return Object.fromEntries(Object.entries(data).map(([key, collection]) => [key, {
      ...collection,
      photos: (collection?.photos || []).filter((photo) => visibleIds.has(photo?.id)),
    }]));
  };

  const finishCatalogLoad = async (source, data, owner, productCatalog) => {
    const existingData = window.photosByElieData || {};
    const filteredData = await applyLifecycleVisibility({ ...(data || {}), ...existingData });
    installLifecycleGuardedCatalog(filteredData);
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
        return await finishCatalogLoad("sqlite", bundle.data, bundle.owner, bundle.productCatalog);
      } catch (error) {
        console.warn(error?.message || "SQLite catalog load failed.");
      }
    }
    lifecycleVisibleIds = new Set();
    installLifecycleGuardedCatalog({});
    window.photosByElieCatalogSource = "lifecycle-denied";
    throw new Error("Could not load a lifecycle-authorized public catalog.");
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
