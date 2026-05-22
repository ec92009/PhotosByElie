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
        const bundle = window.photosByElieCatalogSqlite.decodeCatalog(readBinary("./assets/catalog/photosbyelie.sqlite"));
        return finishCatalogLoad("sqlite", bundle.data, bundle.owner, bundle.productCatalog);
      } catch (error) {
        console.warn(error?.message || "SQLite catalog load failed.");
      }
    }
    throw new Error("Could not load public SQLite catalog.");
  })();
})();
window.photosByElieOriginTypes = {
  camera: { label: "Camera photo", shortLabel: "Camera" },
  ai: { label: "AI image", shortLabel: "AI" }
};
window.photosByEliePhotoOrigin = (photo, collectionKey = "") => {
  const origin = String(photo?.sourceOrigin || photo?.origin || "").toLowerCase();
  if (origin === "ai" || origin === "camera") return origin;
  if (String(photo?.pricingTier || "").toLowerCase() === "ai") return "ai";
  const sourceText = [
    photo?.caption,
    ...(photo?.sourceFiles || []).map((source) => source?.path),
    ...(photo?.metadata || []).map((item) => item?.value)
  ].filter(Boolean).join(" ").toLowerCase();
  if (sourceText.includes("leonardo")) return "ai";
  return String(collectionKey || "").toLowerCase() === "ai" ? "ai" : "camera";
};
window.photosByEliePhotoOriginLabel = (photo, collectionKey = "") => {
  const origin = window.photosByEliePhotoOrigin(photo, collectionKey);
  return window.photosByElieOriginTypes?.[origin]?.label || "Camera photo";
};
window.photosByEliePhotoOriginShortLabel = (photo, collectionKey = "") => {
  const origin = window.photosByEliePhotoOrigin(photo, collectionKey);
  return window.photosByElieOriginTypes?.[origin]?.shortLabel || "Camera";
};
window.photosByElieApplyCollectionOrigins = (collections = {}) => {
  Object.entries(collections || {}).forEach(([slug, collection]) => {
    (collection.photos || []).forEach((photo) => {
      const origin = window.photosByEliePhotoOrigin(photo, slug);
      photo.sourceOrigin = origin;
      photo.pricingTier = origin === "ai" ? "ai" : "original";
    });
  });
  return collections;
};
window.photosByElieApplyCollectionOrigins(window.photosByElieData);
window.photosByElieApplyCollectionOrigins(window.photosByElieOwnerData);
window.photosByElieResolutions = window.photosByElieResolutions || [];
window.photosByEliePriceTiers = window.photosByEliePriceTiers || {};
window.photosByElieFrameOptions = window.photosByElieFrameOptions || [];
window.photosByElieShippingHandlingPrices = window.photosByElieShippingHandlingPrices || {};
window.photosByEliePodAutomation = window.photosByEliePodAutomation || {};
window.photosByEliePodSuppliers = window.photosByEliePodSuppliers || [];
window.photosByEliePodQualityTiers = window.photosByEliePodQualityTiers || [];
window.photosByEliePodOptions = window.photosByEliePodOptions || [];

window.photosByEliePricingTier = (photo) => window.photosByEliePhotoOrigin(photo) === "ai" ? "ai" : "original";
window.photosByEliePricingTierLabel = (photo) => window.photosByEliePriceTiers?.[window.photosByEliePricingTier(photo)]?.label || "Camera photo";
window.photosByElieOptionPrice = (photo, option) => Number(option?.prices?.[window.photosByEliePricingTier(photo)] ?? option?.price ?? 0);

window.photosByElieMediaType = (photo) => String(photo?.media?.type || photo?.type || "photo").toLowerCase();
window.photosByElieIsVideo = (photo) => window.photosByElieMediaType(photo) === "video";
window.photosByElieVideoPriceTiers = window.photosByElieVideoPriceTiers || {};
window.photosByElieVideoTier = (photo) => {
  const duration = Number(photo?.media?.video?.duration || photo?.duration || 0);
  if (duration < 10) return "video_short";
  if (duration < 30) return "video_medium";
  if (duration < 60) return "video_long";
  if (duration < 180) return "video_extended";
  return "video_premium";
};
window.photosByElieVideoDownloadOption = (photo) => {
  const tier = window.photosByElieVideoTier(photo);
  const priceTier = window.photosByElieVideoPriceTiers?.[tier] || { price: 20 };
  return { id: "video-original", type: "video", label: "Original video download", detail: "Private original video file after purchase", price: Number(priceTier.price) || 0, priceKey: tier };
};

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
  if (window.photosByElieIsVideo?.(photo)) return [window.photosByElieVideoDownloadOption(photo)];
  const megapixels = window.photosByElieVerifiedMegapixels(photo);
  if (!megapixels) return [];
  const physicalProductsEnabled = window.photosByElieProductSettings?.physicalProductsEnabled?.() === true;
  return options.filter((option) =>
    (physicalProductsEnabled || option.type !== "print")
    && (!option.minMegapixels || megapixels >= option.minMegapixels)
  ).map((option) => ({ ...option, price: window.photosByElieOptionPrice(photo, option) }));
};

window.photosByElieFormatLabel = (source) => {
  const value = String(source || "");
  const checks = [
    { label: "JPG", pattern: /\b(JPG|JPEG)\b/i },
    { label: "TIFF", pattern: /\b(TIF|TIFF)\b/i },
    { label: "MOV", pattern: /\b(MOV|QUICKTIME)\b/i },
    { label: "MP4", pattern: /\b(MP4|M4V)\b/i },
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
