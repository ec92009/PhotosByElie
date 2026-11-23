// Generated bootstrap: loads the plain SQLite catalog.
(() => {
  const catalogGeneration = Object.freeze({"schemaVersion":1,"path":"./assets/catalog/photosbyelie.sqlite","bytes":5283840,"sha256":"f210bc0b6a6e7bfb29e89dae2189ee09775f3f85950b6e0c8ebfde085972ce2c","pricing":{"path":"./assets/catalog/product-pricing.json","bytes":30726,"sha256":"4ffa3c68fc2666a5d8fb4bb317777ca0040fdc0979c572b2754006254460897f"}});
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
    if (!response.ok) throw new Error(`Could not load ${generation.path}: HTTP ${response.status}`);
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
    return String(config.authWorkerBaseUrl || config.checkoutWorkerBaseUrl || "").trim().replace(/\/+$/, "");
  };

  const publicPhotos = (data = {}) => Object.values(data)
    .flatMap((collection) => Array.isArray(collection?.photos) ? collection.photos : []);

  const requestedDetailPhotoId = () => {
    const pathname = String(window.location.pathname || "");
    const generatedRoute = /\/photo--[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}\.html$/.test(pathname);
    if (!pathname.endsWith("/photo.html") && !generatedRoute) return "";
    const queryId = new URLSearchParams(window.location.search || "").get("id");
    return String(queryId || (generatedRoute ? document.body?.dataset?.photoId : "") || "").trim();
  };

  const lifecycleCandidateIds = (data = {}) => {
    const detailPhotoId = requestedDetailPhotoId();
    if (detailPhotoId) return [detailPhotoId];
    return [...new Set(publicPhotos(data).map((photo) => String(photo?.id || "").trim()).filter(Boolean))];
  };

  const isLocalhost = () => /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
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
    const detailPhotoId = requestedDetailPhotoId();
    const ids = lifecycleCandidateIds(data).filter((id) => catalogPhotosById.has(id));
    if (!base) throw new Error("Lifecycle visibility authority is unavailable.");
    const visibleIds = new Set();
    if (!ids.length) {
      timings.lifecycleBatchCount = 0;
      timings.lifecycleConcurrency = 0;
      timings.lifecycleEndpoint = detailPhotoId ? "visibility" : "visible";
      timings.lifecycleMs = duration(startedAt);
      lifecycleVisibleIds = visibleIds;
      return Object.fromEntries(Object.entries(data).map(([key, collection]) => [key, {
        ...collection,
        photos: [],
      }]));
    }
    const candidateIdSet = new Set(ids);
    let useBatchedVisibility = Boolean(detailPhotoId);
    try {
      if (!useBatchedVisibility) {
        const response = await fetch(`${base}/lifecycle/visible`, {
          method: "GET",
          cache: "no-store",
        });
        if (response.status === 404 || response.status === 405) {
          useBatchedVisibility = true;
        } else {
          if (!response.ok) throw new Error(`Lifecycle visibility failed with HTTP ${response.status}.`);
          const payload = await response.json();
          if (!Array.isArray(payload?.visibleMediaIds)) throw new Error("Lifecycle visibility response is malformed.");
          payload.visibleMediaIds.forEach((id) => {
            if (typeof id !== "string" || !id.trim()) throw new Error("Lifecycle visibility response is malformed.");
            if (candidateIdSet.has(id)) visibleIds.add(id);
          });
          timings.lifecycleBatchCount = 1;
          timings.lifecycleConcurrency = 1;
          timings.lifecycleEndpoint = "visible";
        }
      }
      if (useBatchedVisibility) {
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
          const response = await fetch(`${base}/lifecycle/visibility`, {
            method: "POST",
            cache: "no-store",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ mediaIds: batches[batchIndex] }),
            signal: controller.signal,
          });
          if (!response.ok) throw new Error(`Lifecycle visibility failed with HTTP ${response.status}.`);
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
        timings.lifecycleEndpoint = "visibility";
        try {
          await Promise.all(Array.from({ length: concurrency }, () => authorizeNext()));
        } catch (error) {
          stopped = true;
          controller.abort();
          throw error;
        }
      }
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
})();
// Generated catalog helper boundary.
window.photosByElieResolutions = window.photosByElieResolutions || [];
window.photosByEliePriceTiers = window.photosByEliePriceTiers || {};
window.photosByElieFrameOptions = window.photosByElieFrameOptions || [];
window.photosByElieShippingHandlingPrices = window.photosByElieShippingHandlingPrices || {};
window.photosByEliePodAutomation = window.photosByEliePodAutomation || {};
window.photosByEliePodSuppliers = window.photosByEliePodSuppliers || [];
window.photosByEliePodQualityTiers = window.photosByEliePodQualityTiers || [];
window.photosByEliePodOptions = window.photosByEliePodOptions || [];

window.photosByEliePreviewMegapixels = (photo) => {
  const preview = (photo?.metadata || []).find((item) => item.label === "Preview file")?.value || "";
  const match = preview.match(/(\d+)\s*x\s*(\d+)/i);
  if (!match) return 0;
  return Math.round((Number(match[1]) * Number(match[2]) / 1000000) * 10) / 10;
};

window.photosByElieVerifiedMegapixels = (photo) => {
  if (Array.isArray(photo?.sourceFiles) && photo.sourceFiles.length) return Number(photo.megapixels) || 0;
  return window.photosByEliePreviewMegapixels(photo);
};

window.photosByElieAvailableResolutions = (photo, options = window.photosByElieResolutions || []) => {
  const megapixels = window.photosByElieVerifiedMegapixels(photo);
  if (!megapixels) return [];
  const physicalProductsEnabled = window.photosByElieProductSettings?.physicalProductsEnabled?.() === true;
  return options.filter((option) =>
    (physicalProductsEnabled || option.type !== "print")
    && (!option.minMegapixels || megapixels >= option.minMegapixels)
  );
};

window.photosByElieFormatLabel = (source) => {
  const value = String(source || "");
  const checks = [
    { label: "JPG", pattern: /\b(JPG|JPEG)\b/i },
    { label: "TIFF", pattern: /\b(TIF|TIFF)\b/i },
    { label: "PSD", pattern: /\bPSD\b/i },
  ];
  const formats = checks.filter((item) => item.pattern.test(value)).map((item) => item.label);
  return formats.length ? formats.join(" + ") : value;
};

window.photosByElieSourceFormats = (photo) => {
  if (Array.isArray(photo?.sourceFiles) && photo.sourceFiles.length) {
    const formats = [...new Set(photo.sourceFiles.map((file) => file.type || window.photosByElieFormatLabel(file.path)).filter(Boolean))];
    return formats.join(" + ");
  }
  return photo?.imageSrc ? `${window.photosByElieFormatLabel(photo.imageSrc)} preview/export` : "Source file unverified";
};

window.photosByElieOriginalSize = (photo) => {
  const megapixels = window.photosByElieVerifiedMegapixels(photo);
  const sizeLabel = Array.isArray(photo?.sourceFiles) && photo.sourceFiles.length ? "source" : "verified";
  return [window.photosByElieSourceFormats(photo), megapixels ? `${megapixels} MP ${sizeLabel}` : ""].filter(Boolean).join(", ");
};

window.photosByElieResolutionDetail = (photo, option) => {
  if (option.id !== "full") return option.detail;
  return `Original: ${window.photosByElieOriginalSize(photo)}`;
};
window.photosByElieMeasurementSystem = () => {
  const nav = typeof navigator === "undefined" ? {} : navigator;
  const locales = [...(nav.languages || []), nav.language, Intl.DateTimeFormat().resolvedOptions().locale].filter(Boolean);
  const imperialRegions = new Set(["US", "LR", "MM"]);
  for (const locale of locales) {
    try {
      const intlLocale = new Intl.Locale(locale).maximize();
      if (intlLocale.measurementSystem === "metric" || intlLocale.measurementSystem === "ussystem") {
        return intlLocale.measurementSystem === "ussystem" ? "imperial" : "metric";
      }
      if (intlLocale.region) return imperialRegions.has(intlLocale.region) ? "imperial" : "metric";
    } catch {}
  }
  return "metric";
};
window.photosByElieProductLabel = (option) => {
  if (option?.type !== "print" || !option.dimensions) return option?.label || "";
  const preferred = window.photosByElieMeasurementSystem() === "imperial" ? "imperial" : "metric";
  const secondary = preferred === "imperial" ? "metric" : "imperial";
  return `${option.label} ${option.dimensions[preferred]} / ${option.dimensions[secondary]}`;
};
window.photosByElieFrameLabel = (frameId) => (
  (window.photosByElieFrameOptions || []).find((frame) => frame.id === frameId)?.label || "No frame"
);
window.photosByElieFramePrice = (frame, option) => {
  const frameId = typeof frame === "string" ? frame : frame?.id;
  const catalogFrame = (window.photosByElieFrameOptions || []).find((item) => item.id === frameId);
  const pricedFrame = catalogFrame || frame;
  return Number(pricedFrame?.prices?.[option?.id] ?? pricedFrame?.price ?? frame?.price ?? 0);
};
window.photosByElieOptionQuantity = (option) => option?.type === "print" ? Math.max(1, Number(option.quantity) || 1) : 1;
window.photosByElieOptionShippingHandlingUnitPrice = (option) => option?.type === "print" ? Number(window.photosByElieShippingHandlingPrices?.[option?.id] || 0) : 0;
window.photosByElieOptionShippingHandlingTotal = (option) => window.photosByElieOptionQuantity(option) * window.photosByElieOptionShippingHandlingUnitPrice(option);
window.photosByElieShippingHandlingNote = (option) => {
  const price = window.photosByElieOptionShippingHandlingUnitPrice(option);
  return option?.type === "print" && price ? `S&H $${price} added and removed as a limited-time discount.` : "";
};
window.photosByElieProductDetail = (photo, option) => [
  window.photosByElieResolutionDetail(photo, option),
  window.photosByElieShippingHandlingNote(option)
].filter(Boolean).join(" ");
window.photosByElieOptionUnitPrice = (option) => Number(option?.price) + Number(window.photosByElieFramePrice?.(option?.frame, option) || 0);
window.photosByElieOptionTotal = (option) => window.photosByElieOptionQuantity(option) * window.photosByElieOptionUnitPrice(option);
