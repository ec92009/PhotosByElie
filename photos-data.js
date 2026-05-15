// Generated bootstrap: loads the public catalog from TSV shards.
(() => {
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
      throw new Error(`Could not load ${relativePath}: HTTP ${request.status}`);
    }
    const [headerLine, ...lines] = request.responseText.split(/\n/).filter((line) => line.length);
    const columns = headerLine.split("\t");
    return lines.map((line) => {
      const values = line.split("\t");
      return Object.fromEntries(columns.map((column, index) => [column, values[index] ?? ""]));
    });
  };

  const data = {};
  const owner = {};
  const targets = { public: data, owner };
  for (const row of readTsv("./assets/catalog/collections.tsv")) {
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

  for (const row of readTsv("./assets/catalog/photos.tsv")) {
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
window.photosByElieResolutions = [
  { id: "full", type: "digital", label: "Full resolution", detail: "Original source file at native resolution", price: 65, prices: { original: 65, ai: 25 } },
  { id: "jpg-6mp", type: "digital", label: "JPG 6 MP", detail: "Long edge export for print and premium web", price: 28, prices: { original: 28, ai: 14 }, minMegapixels: 6 },
  { id: "jpg-3mp", type: "digital", label: "JPG 3 MP", detail: "Listing, portfolio, and editorial web use", price: 16, prices: { original: 16, ai: 8 }, minMegapixels: 3 },
  { id: "jpg-1mp", type: "digital", label: "JPG 1 MP", detail: "Small web preview and social draft use", price: 8, prices: { original: 8, ai: 4 }, minMegapixels: 1 },
  { id: "print-4x6", type: "print", label: "Print", dimensions: { imperial: "4 x 6 in", metric: "10 x 15 cm" }, detail: "Small classic photo print", price: 12, minMegapixels: 1 },
  { id: "print-5x7", type: "print", label: "Print", dimensions: { imperial: "5 x 7 in", metric: "13 x 18 cm" }, detail: "Popular gift and desk frame size", price: 18, minMegapixels: 2 },
  { id: "print-8x10", type: "print", label: "Print", dimensions: { imperial: "8 x 10 in", metric: "20 x 25 cm" }, detail: "Popular wall and shelf print size", price: 32, minMegapixels: 6 },
  { id: "print-11x14", type: "print", label: "Print", dimensions: { imperial: "11 x 14 in", metric: "28 x 36 cm" }, detail: "Larger display print with manual crop review", price: 48, minMegapixels: 10 }
];
window.photosByEliePriceTiers = {
  original: { label: "Camera photo" },
  ai: { label: "AI image" }
};
window.photosByElieFrameOptions = [
  { id: "none", label: "No frame", price: 0 },
  { id: "white", label: "Plain white frame", price: 37, prices: { "print-4x6": 33, "print-5x7": 37, "print-8x10": 53, "print-11x14": 77 } },
  { id: "black", label: "Plain black frame", price: 37, prices: { "print-4x6": 33, "print-5x7": 37, "print-8x10": 53, "print-11x14": 77 } }
];
window.photosByElieShippingHandlingPrices = {
  "print-4x6": 7,
  "print-5x7": 8,
  "print-8x10": 12,
  "print-11x14": 16
};

window.photosByEliePricingTier = (photo) => window.photosByEliePhotoOrigin(photo) === "ai" ? "ai" : "original";
window.photosByEliePricingTierLabel = (photo) => window.photosByEliePriceTiers?.[window.photosByEliePricingTier(photo)]?.label || "Camera photo";
window.photosByElieOptionPrice = (photo, option) => Number(option?.prices?.[window.photosByEliePricingTier(photo)] ?? option?.price ?? 0);
window.photosByElieVideoPriceTiers = {
  video_short: { label: "Video under 10s", price: 20 },
  video_medium: { label: "Video 10-30s", price: 20 },
  video_long: { label: "Video 30-60s", price: 20 },
  video_extended: { label: "Video 1-3 min", price: 20 },
  video_premium: { label: "Video 3+ min", price: 20 },
};
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
  return {
    id: "video-original",
    type: "video",
    label: "Original video download",
    detail: "Private original video file after purchase",
    price: Number(priceTier.price) || 0,
    priceKey: tier,
  };
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
