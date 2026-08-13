// Generated bootstrap: loads the plain SQLite catalog.
(() => {
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
      throw new Error(`Could not load ${relativePath}: HTTP ${request.status}`);
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
    return String(config.authWorkerBaseUrl || config.checkoutWorkerBaseUrl || "").trim().replace(/\/+$/, "");
  };

  const publicPhotos = (data = {}) => Object.values(data)
    .flatMap((collection) => Array.isArray(collection?.photos) ? collection.photos : []);

  const isLocalhost = () => /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
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
    const ids = [...new Set(publicPhotos(data).map((photo) => String(photo?.id || "").trim()).filter(Boolean))];
    const requestedIds = new Set(ids);
    if (!base || !ids.length) throw new Error("Lifecycle visibility authority is unavailable.");
    const visibleIds = new Set();
    for (let index = 0; index < ids.length; index += 100) {
      const response = await fetch(`${base}/lifecycle/visibility`, {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mediaIds: ids.slice(index, index + 100) }),
      });
      if (!response.ok) throw new Error(`Lifecycle visibility failed with HTTP ${response.status}.`);
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
