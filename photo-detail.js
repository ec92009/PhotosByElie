((async () => {
const params = new URLSearchParams(window.location.search);
const requestedCollectionKey = String(params.get("gallery") || "").trim().toLowerCase();
const isRequestedPBEOwnerCollection = requestedCollectionKey === "pbe-owner";
if (isRequestedPBEOwnerCollection) {
  document.body.dataset.gallery = "pbe-owner";
  if (!document.head.querySelector('meta[name="robots"]')) {
    const robots = document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex,nofollow";
    document.head.append(robots);
  }
}
if (typeof window.photosByEliePageReady !== "function") throw new Error("Photo readiness is unavailable.");
await window.photosByEliePageReady();
if (window.photosByElieReserve?.enabled) {
  await window.photosByElieReserve.load();
}
if (window.photosByElieHidden?.enabled) {
  await window.photosByElieHidden.load();
}
await window.photosByElieHiddenBlacklistReady;
window.photosByElieProductSettings?.applyPriceOverrides?.();
const formatMoney = (value) => {
  const amount = Number(value) || 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: amount % 1 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(amount);
};
const requestedPhotoId = params.get("id") || "";
const photoId = requestedPhotoId || "france-1";
const ownerReviewDetailPhotoStateKey = "photosbyelie-owner-review-detail-photo";
const ownerReviewDetailPhotoMaxAgeMs = 1000 * 60 * 60 * 2;
const readOwnerReviewDetailPhotoPayload = () => {
  if (params.get("from") !== "owner-review") return null;
  try {
    const payload = JSON.parse(sessionStorage.getItem(ownerReviewDetailPhotoStateKey) || "null");
    if (
      payload?.source === "owner-review"
      && payload?.photo?.id === photoId
      && Date.now() - Number(payload.createdAt || 0) < ownerReviewDetailPhotoMaxAgeMs
    ) {
      return payload;
    }
  } catch {}
  return null;
};
const ownerReviewDetailPhotoPayload = readOwnerReviewDetailPhotoPayload();
const collections = window.photosByElieData || {};
const ownerCollections = window.photosByElieOwnerData || {};
const reserveCollections = window.photosByElieReserveData || {};
const hiddenCollections = window.photosByElieHiddenData || {};
const fallbackCollection = Object.values(collections).find((collection) => Array.isArray(collection.photos) && collection.photos.length)
  || collections.france
  || { title: "Gallery", accent: "", photos: [] };
const requestedCollectionEntry = requestedCollectionKey && collections[requestedCollectionKey]?.photos?.some((photo) => photo.id === photoId)
  ? [requestedCollectionKey, collections[requestedCollectionKey]]
  : null;
const originalRegularCollectionEntry = requestedCollectionEntry || Object.entries(collections).find(([, collection]) =>
  collection.photos.some((photo) => photo.id === photoId)
);
const promotedCollectionEntry = originalRegularCollectionEntry ? null : Object.entries(collections).find(([galleryKey]) =>
  window.photosByElieReserve?.promotedIds?.(galleryKey)?.includes(photoId)
);
const promotedPhoto = promotedCollectionEntry
  ? (reserveCollections[promotedCollectionEntry[0]]?.photos || []).find((item) => item.id === photoId)
  : null;
const regularCollectionEntry = originalRegularCollectionEntry || (promotedPhoto ? promotedCollectionEntry : null);
const reserveCollectionEntry = regularCollectionEntry ? null : Object.entries(reserveCollections).find(([, collection]) =>
  collection.photos.some((photo) => photo.id === photoId)
);
const ownerCollectionEntry = Object.entries(ownerCollections).find(([, collection]) =>
  collection.photos.some((photo) => photo.id === photoId)
);
const hiddenCollectionEntry = regularCollectionEntry || reserveCollectionEntry || ownerCollectionEntry ? null : Object.entries(hiddenCollections).find(([, collection]) =>
  collection.photos.some((photo) => photo.id === photoId)
);
const ownerReviewSyntheticCollectionEntry = (
  !regularCollectionEntry
  && !reserveCollectionEntry
  && !ownerCollectionEntry
  && !hiddenCollectionEntry
  && ownerReviewDetailPhotoPayload?.photo?.id === photoId
) ? [
  String(ownerReviewDetailPhotoPayload.collectionKey || "owner-review"),
  {
    title: String(ownerReviewDetailPhotoPayload.collectionTitle || "Title / keywords review"),
    accent: "owner-title-keyword-review",
    photos: [ownerReviewDetailPhotoPayload.photo],
  },
] : null;
const collectionEntry = regularCollectionEntry || reserveCollectionEntry || ownerCollectionEntry || hiddenCollectionEntry || ownerReviewSyntheticCollectionEntry;
if (requestedPhotoId && !collectionEntry) {
  const replacement = window.photosByElieVersionedHref?.("./gallery.html?gallery=selection") || "./gallery.html?gallery=selection";
  window.location.replace(replacement);
  return;
}
const isReserveCollection = Boolean(!regularCollectionEntry && reserveCollectionEntry);
const isOwnerCollection = Boolean(!regularCollectionEntry && !reserveCollectionEntry && ownerCollectionEntry);
const isHiddenCollection = Boolean(!regularCollectionEntry && !reserveCollectionEntry && !ownerCollectionEntry && hiddenCollectionEntry);
const isOwnerReviewSyntheticCollection = Boolean(!regularCollectionEntry && !reserveCollectionEntry && !ownerCollectionEntry && !hiddenCollectionEntry && ownerReviewSyntheticCollectionEntry);
const [collectionKey, collection] = collectionEntry || ["france", fallbackCollection];
const photo = promotedPhoto || collection.photos.find((item) => item.id === photoId) || collection.photos[0] || null;
const photoIndex = photo ? collection.photos.findIndex((item) => item.id === photo.id) : -1;
const resolutions = window.photosByElieResolutions || [];
const priceAscending = (options = []) => options.map((option, index) => ({ option, index }))
  .sort((left, right) => {
    const priceDelta = (Number(left.option?.price) || 0) - (Number(right.option?.price) || 0);
    const sortDelta = (Number(left.option?.sortOrder) || 0) - (Number(right.option?.sortOrder) || 0);
    return priceDelta || sortDelta || left.index - right.index;
  })
  .map(({ option }) => option);
const availableResolutions = priceAscending(photo && window.photosByElieIsVideo?.(photo)
  ? [window.photosByElieVideoDownloadOption?.(photo)].filter(Boolean)
  : photo && window.photosByElieAvailableResolutions
    ? window.photosByElieAvailableResolutions(photo, resolutions)
    : resolutions);
const basketStore = window.photosByElieBasket;
const likedStore = window.photosByElieLiked;
const hiddenActions = window.photosByElieHiddenActions;
const localModerationEnabled = Boolean(hiddenActions?.enabled);
const ownerCullingEnabled = Boolean(hiddenActions?.cullingEnabled);
const isPBEOwnerCollection = collectionKey === "pbe-owner";
const fullOwnerToolsEnabled = localModerationEnabled && !isPBEOwnerCollection;
const ownerDetailPurchaseHidden = isOwnerCollection
  || isHiddenCollection
  || isOwnerReviewSyntheticCollection
  || isPBEOwnerCollection;
const versionedHref = (href) => window.photosByElieVersionedHref?.(href) || href;
const galleryHrefForKey = (key) => `./gallery.html?gallery=${encodeURIComponent(key)}`;
const t = (key, replacements = {}) => window.photosByElieI18n?.t?.(key, replacements) || key;
const localizedCollectionTitle = () => {
  const key = `collection.${collectionKey}`;
  const translated = t(key);
  return translated && translated !== key ? translated : collection.title;
};
const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;",
}[char]));
const productLabel = (option) => {
  if (option?.type === "print") return window.photosByElieProductLabel?.(option) || option?.label || t("product.print");
  const keyById = {
    full: "product.full",
    "jpg-6mp": "product.jpg_6",
    "jpg-3mp": "product.jpg_3",
    "jpg-1mp": "product.jpg_1",
  };
  return t(keyById[option?.id] || "", {}) || window.photosByElieProductLabel?.(option) || option?.label || "";
};
const frameLabel = (frame) => ({
  none: t("product.no_frame"),
  white: t("product.white_frame"),
  black: t("product.black_frame"),
}[frame?.id] || frame?.label || "");
const photoOrigin = photo
  ? (window.photosByEliePhotoOrigin?.(photo, collectionKey) || (collectionKey === "ai" ? "ai" : "camera"))
  : "camera";
const photoOriginLabel = photo ? (() => {
  if (window.photosByElieIsVideo?.(photo)) return "Video";
  const key = photoOrigin === "ai" ? "origin.ai" : "origin.camera";
  const translated = t(key);
  return translated && translated !== key ? translated : window.photosByEliePhotoOriginLabel?.(photo, collectionKey);
})() : "";
const videoDurationLabel = photo && window.photosByElieIsVideo?.(photo)
  ? window.photosByElieVideoDurationLabel?.(photo) || ""
  : "";
if (!isOwnerReviewSyntheticCollection && window.photosByElieIsPublicHidden?.(photo)) {
  window.location.replace(versionedHref(galleryHrefForKey(collectionKey)));
  return;
}
const detailSequenceKey = "photosbyelie-detail-sequence";
const galleryReturnStateKey = "photosbyelie-gallery-return-state";
const ownerReviewReturnStateKey = "photosbyelie-owner-review-return-state";
const ownerReviewReturnMaxAgeMs = 1000 * 60 * 60 * 2;
const metadataValue = (targetPhoto, label) => (
  (targetPhoto?.metadata || []).find((item) => item.label === label)?.value || ""
);
const setPhotoMetaText = (value) => {
  const metaRoot = document.querySelector("[data-photo-meta]");
  if (!metaRoot) return;
  metaRoot.removeAttribute("data-i18n");
  metaRoot.textContent = value;
};
const setCollectionNav = () => {
  const currentNav = document.querySelector("[data-nav-current]");
  if (!currentNav) return;
  currentNav.dataset.i18n = `collection.${collectionKey}`;
  currentNav.textContent = localizedCollectionTitle();
  currentNav.setAttribute("href", versionedHref(galleryHrefForKey(collectionKey)));
};
const splitKeywordText = (value) => String(value || "")
  .split(/[;,]/)
  .map((keyword) => keyword.trim())
  .filter(Boolean);
const uniqueKeywords = (items) => {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
const setMetadataValue = (targetPhoto, label, value) => {
  if (!Array.isArray(targetPhoto.metadata)) targetPhoto.metadata = [];
  const item = targetPhoto.metadata.find((entry) => entry.label === label);
  if (item) {
    item.value = value;
    return;
  }
  targetPhoto.metadata.unshift({ label, value });
};
if ((isOwnerCollection || isHiddenCollection) && !localModerationEnabled) {
  window.location.replace(versionedHref("./"));
  return;
}
const detailShortcutHint = document.querySelector("[data-detail-shortcut-hint]");
const detailShortcutKey = (label) => `<kbd>${label}</kbd>`;
const shouldShowKeyboardHints = () => window.photosByElieInputMode?.shouldShowKeyboardHints?.() ?? true;
const renderDetailShortcutHint = () => {
  if (!detailShortcutHint) return;
  if (!photo || !shouldShowKeyboardHints()) {
    detailShortcutHint.hidden = true;
    return;
  }
  const ownerShortcuts = ownerCullingEnabled
    ? [
      `${detailShortcutKey("X")} block`,
      `${detailShortcutKey("U")} undo`,
      ...(fullOwnerToolsEnabled ? [
        `${detailShortcutKey("T")} title`,
        `${detailShortcutKey("K")} keywords`,
        `${detailShortcutKey("R")} review`
      ] : [])
    ]
    : [];
  detailShortcutHint.innerHTML = [
    t("detail.shortcuts"),
    `${detailShortcutKey("L")} ${t("detail.like")}`,
    `${detailShortcutKey("Left/Right")} ${t("detail.prev_next")}`,
    `${detailShortcutKey("Double-click")} ${t("detail.full_screen")}`,
    ...ownerShortcuts
  ].join(" <span aria-hidden=\"true\">|</span> ");
  detailShortcutHint.hidden = false;
};
renderDetailShortcutHint();
window.addEventListener("photosbyelie:inputmodechange", renderDetailShortcutHint);
const promotedPhotosFor = (galleryKey) => {
  if (!localModerationEnabled || !window.photosByElieReserve?.enabled) return [];
  const reserveById = new Map((reserveCollections[galleryKey]?.photos || []).map((item) => [item.id, item]));
  return window.photosByElieReserve.promotedIds(galleryKey)
    .map((promotedId) => reserveById.get(promotedId))
    .filter(Boolean);
};

const visiblePhotosFor = (galleryKey, targetCollection, options = {}) => {
  const basePhotos = targetCollection?.photos || [];
  if (!localModerationEnabled || !hiddenActions?.filterPhotos) return basePhotos;
  const photos = hiddenActions.filterPhotos(basePhotos, { includeReserveOnly: options.includeReserveOnly });
  if (!options.includePromotions) return photos;
  const promoted = hiddenActions.filterPhotos(promotedPhotosFor(galleryKey), { includeReserveOnly: true });
  return photos.concat(promoted);
};

const visibleCollectionPhotos = () => visiblePhotosFor(collectionKey, collection, {
  includeReserveOnly: isReserveCollection,
  includePromotions: !isReserveCollection && !isOwnerCollection,
});

const detailScopeEntries = () => {
  const scope = isOwnerCollection
    ? ownerCollections
    : isHiddenCollection
      ? hiddenCollections
    : isReserveCollection
      ? reserveCollections
      : collections;
  return Object.entries(scope).filter(([, scopeCollection]) =>
    Array.isArray(scopeCollection.photos) && scopeCollection.photos.length
  );
};

const readGallerySequencePayload = () => {
  try {
    const payload = JSON.parse(sessionStorage.getItem(detailSequenceKey) || "null");
    if (!payload || !["gallery", "home"].includes(payload.source) || !Array.isArray(payload.photoIds)) return null;
    return payload;
  } catch {
    return null;
  }
};

const detailSequence = () => detailScopeEntries().flatMap(([scopeKey, scopeCollection]) =>
  visiblePhotosFor(scopeKey, scopeCollection, {
    includeReserveOnly: isReserveCollection,
    includePromotions: !isReserveCollection && !isOwnerCollection,
  }).map((scopePhoto) => ({
    collection: scopeCollection,
    collectionKey: scopeKey,
    photo: scopePhoto,
  }))
);

const galleryDetailSequence = () => {
  const payload = readGallerySequencePayload();
  if (!payload?.photoIds.includes(photo?.id)) return null;
  const byId = new Map(detailSequence().map((item) => [item.photo.id, item]));
  const ordered = payload.photoIds
    .map((id) => byId.get(id))
    .filter(Boolean);
  return ordered.some((item) => item.photo.id === photo.id) ? ordered : null;
};

const activeDetailSequence = () => galleryDetailSequence() || detailSequence();

const navigateAfterHide = () => {
  const remainingPhotos = visibleCollectionPhotos();
  if (!remainingPhotos.length) {
    const remainingSequence = activeDetailSequence().filter((item) => item.photo.id !== photo.id);
    window.location.replace(versionedHref(remainingSequence.length ? `./photo.html?id=${remainingSequence[0].photo.id}` : galleryHrefForKey(collectionKey)));
    return true;
  }

  const currentVisibleIndex = remainingPhotos.findIndex((item) => item.id === photo.id);
  if (currentVisibleIndex >= 0) return false;

  const nextPhoto = collection.photos
    .slice(photoIndex + 1)
    .concat(collection.photos.slice(0, photoIndex))
    .find((item) => remainingPhotos.some((candidate) => candidate.id === item.id));

  window.location.replace(versionedHref(`./photo.html?id=${(nextPhoto || remainingPhotos[0]).id}`));
  return true;
};

const navigateAwayFromBlockedPhoto = () => {
  if (navigateAfterHide()) return true;
  const fallbackPhoto = collection.photos
    .slice(photoIndex + 1)
    .concat(collection.photos.slice(0, photoIndex))
    .find((item) => item.id !== photo.id);
  window.location.replace(versionedHref(fallbackPhoto ? `./photo.html?id=${fallbackPhoto.id}` : galleryHrefForKey(collectionKey)));
  return true;
};

const frameOptions = () => window.photosByElieFrameOptions || [];
const defaultFrame = () => frameOptions()[0] || { id: "none", label: "No frame", price: 0 };
const frameFor = (frameId) => frameOptions().find((frame) => frame.id === frameId) || defaultFrame();
const framePriceFor = (frame, option) => window.photosByElieFramePrice?.(frame, option) || Number(frame?.price) || 0;
const printQuantityFor = (optionId) => Math.max(1, Math.min(99, Math.round(Number(document.querySelector(`[data-print-quantity="${optionId}"]`)?.value) || 1)));
const selectedFrameFor = (option) => {
  const frame = frameFor(document.querySelector(`[data-print-frame="${option.id}"]:checked`)?.value || "none");
  return { id: frame.id, label: frame.label, price: framePriceFor(frame, option) };
};
const selectedOptions = () => Array.from(document.querySelectorAll("[data-resolution]:checked"))
  .map((input) => {
    const option = availableResolutions.find((item) => item.id === input.value);
    if (!option) return null;
    const selected = {
      id: option.id,
      type: option.type || "digital",
      label: option.label,
      detail: option.detail,
      dimensions: option.dimensions,
      price: option.price,
      priceKey: option.priceKey,
    };
    if (selected.type === "print") {
      selected.quantity = printQuantityFor(option.id);
      selected.frame = selectedFrameFor(option);
    }
    return selected;
  })
  .filter(Boolean);

const updateTotal = () => {
  const totalTarget = document.querySelector("[data-selection-total]");
  if (!totalTarget) return;
  const total = selectedOptions().reduce((sum, option) => sum + (window.photosByElieOptionTotal?.(option) || option.price), 0);
  totalTarget.textContent = formatMoney(total);
};

const basketItemForPhoto = () => basketStore.read().find((item) => item.photoId === photo.id);
const status = document.querySelector("[data-basket-status]");
const likeToggle = document.querySelector("[data-like-toggle]");
if (ownerDetailPurchaseHidden) {
  const purchasePanel = document.querySelector(".purchase-panel");
  const detailPanel = document.querySelector(".detail-panel");
  document.body.dataset.ownerDetailMode = "true";
  if (status && detailPanel) {
    status.classList.add("owner-detail-status");
    detailPanel.append(status);
  }
  if (purchasePanel) purchasePanel.hidden = true;
}

if (!photo) {
  document.title = `Photos By Elie | ${collection.title}`;
  setCollectionNav();
  document.querySelector("[data-photo-title]").textContent = t("detail.archive_reset_title");
  setPhotoMetaText(t("detail.no_published_meta", { collection: collection.title }));
  document.querySelector("[data-back-link]").setAttribute("href", versionedHref(galleryHrefForKey(collectionKey)));
  document.querySelector("[data-resolution-list]").innerHTML = "";
  document.querySelector("[data-selection-total]").textContent = "$0";
  const metadataRoot = document.querySelector("[data-photo-metadata]");
  metadataRoot.hidden = true;
  const preview = document.querySelector("[data-photo-preview]");
  preview.classList.add(collection.accent);
  preview.querySelector("[data-photo-preview-title]").textContent = t("detail.no_published");
  if (status) status.textContent = t("detail.rebuilding");
} else {
document.title = `Photos By Elie | ${photo.title}`;
const publicDetailUrl = window.photosByElieSeo?.pageUrl?.("/photo.html", { id: photo.id });
const publicImage = window.photosByElieMediaUrl?.(photo, "detail") || window.photosByElieMediaUrl?.(photo, "gallery") || window.photosByElieSeo?.defaultImage;
if (!ownerDetailPurchaseHidden && !isHiddenCollection && !isOwnerCollection && !isOwnerReviewSyntheticCollection) {
  const publicKeywords = uniqueKeywords([
    ...splitKeywordText(metadataValue(photo, "Keywords")),
    ...(Array.isArray(photo.keywords) ? photo.keywords : []),
    localizedCollectionTitle(),
  ]);
  const publicDescription = metadataValue(photo, "Description")
    || `${photo.title} from the ${localizedCollectionTitle()} gallery by Photos By Elie.`;
  window.photosByElieSeo?.applyPageMeta({
    title: `Photos By Elie | ${photo.title}`,
    description: publicDescription,
    url: publicDetailUrl,
    image: publicImage,
    imageAlt: photo.title,
    type: "article",
    jsonLd: window.photosByElieSeo.imageObjectJsonLd({
      name: photo.title,
      description: publicDescription,
      url: publicDetailUrl,
      image: publicImage,
      collectionName: localizedCollectionTitle(),
      keywords: publicKeywords,
    }),
  });
}
setCollectionNav();
const titleTarget = document.querySelector("[data-photo-title]");
titleTarget?.removeAttribute("data-i18n");
if (titleTarget) titleTarget.textContent = photo.title;
setPhotoMetaText([
  collection.title,
  photoOriginLabel,
  window.photosByElieSourceFormats ? window.photosByElieSourceFormats(photo) : photo.full,
  videoDurationLabel,
  window.photosByElieVerifiedMegapixels && window.photosByElieVerifiedMegapixels(photo)
    ? t("detail.mp_verified", { mp: window.photosByElieVerifiedMegapixels(photo) })
    : ""
].filter(Boolean).join(" / "));

const galleryReturnCollectionKey = () => {
  const payload = readGallerySequencePayload();
  if (payload?.source === "gallery" && payload?.photoIds.includes(photo?.id) && payload.collectionKey) return payload.collectionKey;
  return collectionKey;
};
const isHomeDetailSequence = () => {
  const payload = readGallerySequencePayload();
  return Boolean(payload?.source === "home" && payload.photoIds.includes(photo?.id));
};
const ownerReviewReturnHrefFor = (view = "title-keywords", returnPhotoId = photo.id, mode = "") => {
  const returnParams = new URLSearchParams({ view: String(view || "title-keywords") });
  if (returnPhotoId) returnParams.set("returnPhoto", returnPhotoId);
  if (mode) returnParams.set("mode", mode);
  const stored = readOwnerReviewReturnPayload();
  const scrollY = Number(stored?.scrollY);
  if (Number.isFinite(scrollY) && scrollY >= 0) returnParams.set("returnScroll", String(Math.round(scrollY)));
  return `./owner-review.html?${returnParams.toString()}`;
};
const readOwnerReviewReturnPayload = () => {
  try {
    const payload = JSON.parse(sessionStorage.getItem(ownerReviewReturnStateKey) || "null");
    if (
      payload?.source === "owner-review"
      && Date.now() - Number(payload.createdAt || 0) < ownerReviewReturnMaxAgeMs
    ) {
      return payload;
    }
  } catch {}
  return null;
};
const ownerReviewReturnContext = (() => {
  const fromOwnerReview = params.get("from") === "owner-review";
  const stored = readOwnerReviewReturnPayload();
  if (!fromOwnerReview && stored?.photoId !== photo.id) return null;
  if (!fromOwnerReview && !stored) return null;
  const view = params.get("returnView") || stored?.view || "title-keywords";
  const returnPhotoId = params.get("returnPhoto") || stored?.photoId || photo.id;
  const mode = params.get("returnMode") || stored?.mode || stored?.returnMode || "";
  const scrollY = Number(params.get("returnScroll") || stored?.scrollY);
  return {
    href: ownerReviewReturnHrefFor(view, returnPhotoId, mode),
    label: "Back to review",
    photoId: returnPhotoId,
    scrollY: Number.isFinite(scrollY) ? scrollY : null,
    view,
    mode,
  };
})();
const detailBackContext = () => {
  if (ownerReviewReturnContext) {
    return { href: ownerReviewReturnContext.href, label: ownerReviewReturnContext.label };
  }
  const labelKey = isHomeDetailSequence() ? "common.back_to_search" : "common.back_to_gallery";
  return { href: isHomeDetailSequence() ? "./#discover" : galleryHrefForKey(galleryReturnCollectionKey()), labelKey };
};
const writeGalleryReturnState = () => {
  if (ownerReviewReturnContext) return;
  const payload = readGallerySequencePayload();
  if (payload?.source === "home") return;
  const publicFilterState = payload?.filterState && typeof payload.filterState === "object"
    ? Object.fromEntries(
      Object.entries(payload.filterState).filter(([key]) => !["mediaType", "media_type"].includes(key)),
    )
    : null;
  try {
    sessionStorage.setItem(galleryReturnStateKey, JSON.stringify({
      source: "detail",
      collectionKey: galleryReturnCollectionKey(),
      photoId: photo.id,
      photoIds: payload?.photoIds || [photo.id],
      selectionIds: Array.isArray(payload?.selectionIds) ? payload.selectionIds.slice(0, 500) : [],
      primaryPhotoId: payload?.primaryPhotoId || "",
      selectionRecency: Array.isArray(payload?.selectionRecency) ? payload.selectionRecency.slice(-500) : [],
      navigationNonce: payload?.navigationNonce || "",
      filterState: publicFilterState,
      visibleLimit: payload?.visibleLimit || null,
      createdAt: Date.now()
    }));
  } catch {
    // Normal link navigation still works if sessionStorage is unavailable.
  }
};
const backLink = document.querySelector("[data-back-link]");
const backContext = detailBackContext();
backLink.setAttribute("href", versionedHref(backContext.href));
if (backContext.labelKey) {
  backLink.dataset.i18nAriaLabel = backContext.labelKey;
  backLink.setAttribute("aria-label", t(backContext.labelKey));
} else {
  delete backLink.dataset.i18nAriaLabel;
  backLink.setAttribute("aria-label", backContext.label);
}
if (backLink.classList.contains("header-back-button")) {
  delete backLink.dataset.i18n;
} else {
  if (backContext.labelKey) {
    backLink.dataset.i18n = backContext.labelKey;
    backLink.textContent = t(backContext.labelKey);
  } else {
    delete backLink.dataset.i18n;
    backLink.textContent = backContext.label;
  }
}

let previousPhotoHref = "";
let nextPhotoHref = "";
const detailPhotoHref = (targetPhotoId) => {
  const detailParams = new URLSearchParams({ id: targetPhotoId });
  const returnCollectionKey = galleryReturnCollectionKey();
  if (returnCollectionKey === "shared") detailParams.set("gallery", "shared");
  if (returnCollectionKey === "pbe-owner") detailParams.set("gallery", "pbe-owner");
  if (ownerReviewReturnContext) {
    detailParams.set("from", "owner-review");
    detailParams.set("returnView", ownerReviewReturnContext.view);
    detailParams.set("returnPhoto", ownerReviewReturnContext.photoId);
    if (ownerReviewReturnContext.mode) detailParams.set("returnMode", ownerReviewReturnContext.mode);
  }
  return `./photo.html?${detailParams.toString()}`;
};
const navigateToPhotoHref = (href) => {
  if (href) window.location.assign(versionedHref(href));
};

const ensureDetailBottomActions = () => {
  const detailMain = document.querySelector(".detail-main");
  if (document.querySelector(".header-back-button[data-back-link]")) return;
  if (!detailMain || document.querySelector("[data-detail-bottom-actions]")) return;
  const bottomActions = document.createElement("nav");
  bottomActions.className = "panel mobile-bottom-actions detail-bottom-actions";
  bottomActions.dataset.detailBottomActions = "";
  bottomActions.setAttribute("aria-label", t("a11y.bottom_photo_actions"));
  bottomActions.innerHTML = `
    <a class="btn secondary" data-bottom-back-link href="${galleryHrefForKey(collectionKey)}" data-i18n="common.back_to_gallery">Back to gallery</a>
  `;
  detailMain.append(bottomActions);
  window.photosByElieVersionInternalLinks?.(bottomActions);
  window.photosByElieI18n?.apply?.();
};

const syncDetailBottomActions = () => {
  ensureDetailBottomActions();
  const bottomActions = document.querySelector("[data-detail-bottom-actions]");
  if (!bottomActions) return;
  const bottomBack = bottomActions.querySelector("[data-bottom-back-link]");
  const topBack = document.querySelector("[data-back-link]");
  const backHref = topBack?.getAttribute("href") || galleryHrefForKey(collectionKey);
  if (bottomBack) {
    bottomBack.setAttribute("href", versionedHref(backHref));
    bottomBack.dataset.i18n = topBack?.dataset.i18n || "common.back_to_gallery";
    bottomBack.textContent = topBack?.textContent || t(bottomBack.dataset.i18n);
  }
};

const detailPhotos = activeDetailSequence();
const detailIndex = detailPhotos.findIndex((item) => item.photo.id === photo.id);
if (detailPhotos.length > 1 && detailIndex >= 0) {
  const previousEntry = detailPhotos[(detailIndex - 1 + detailPhotos.length) % detailPhotos.length];
  const nextEntry = detailPhotos[(detailIndex + 1) % detailPhotos.length];
  previousPhotoHref = detailPhotoHref(previousEntry.photo.id);
  nextPhotoHref = detailPhotoHref(nextEntry.photo.id);
}
syncDetailBottomActions();
document.querySelectorAll("[data-back-link], [data-bottom-back-link]").forEach((link) => {
  link.addEventListener("click", writeGalleryReturnState);
});

const metadataRoot = document.querySelector("[data-photo-metadata]");
const metadataToggle = document.querySelector("[data-photo-info-toggle]");
metadataToggle?.addEventListener("click", () => {
  const expanded = metadataToggle.getAttribute("aria-expanded") !== "true";
  metadataToggle.setAttribute("aria-expanded", String(expanded));
  if (metadataRoot) metadataRoot.hidden = !expanded;
});
const renderMetadataRows = () => {
  const hiddenLabels = new Set(["preview file", "software", "color profile", "metadata title", "origin"]);
  const metadata = Array.isArray(photo.metadata)
    ? photo.metadata.filter((item) => item.label && item.value && !hiddenLabels.has(String(item.label).toLowerCase()))
    : [];
  const hasDurationRow = metadata.some((item) => String(item.label).toLowerCase() === "duration");
  const rows = [
    ...(!hasDurationRow && videoDurationLabel ? [{ label: "Duration", value: videoDurationLabel }] : []),
    ...metadata,
  ].filter((item) => item.label && item.value);
  const hasRows = rows.length > 0;
  metadataRoot.hidden = !hasRows;
  if (metadataToggle) {
    metadataToggle.hidden = !hasRows;
    metadataToggle.setAttribute("aria-expanded", String(hasRows));
  }
  metadataRoot.replaceChildren(...rows.map((item) => {
    const row = document.createElement("div");
    const label = document.createElement("dt");
    const value = document.createElement("dd");
    label.textContent = item.label;
    value.textContent = item.value;
    row.append(label, value);
    return row;
  }));
};

const syncTitleUi = () => {
  document.title = `Photos By Elie | ${photo.title}`;
  const titleTarget = document.querySelector("[data-photo-title]");
  const previewTitleTarget = document.querySelector("[data-photo-preview-title]");
  titleTarget?.removeAttribute("data-i18n");
  previewTitleTarget?.removeAttribute("data-i18n");
  if (titleTarget) titleTarget.textContent = photo.title;
  if (previewTitleTarget) previewTitleTarget.textContent = photo.title;
  document.querySelector("[data-photo-preview] img")?.setAttribute("alt", photo.title);
};

const openOwnerMetadataModal = (field) => {
  if (!ownerCullingEnabled || !fullOwnerToolsEnabled || !photo) return;
  const isKeywords = field === "keywords";
  const dialog = document.createElement("dialog");
  dialog.className = "owner-metadata-modal";
  const title = isKeywords ? "Edit keywords" : "Edit title";
  const currentKeywords = metadataValue(photo, "Keywords");
  const value = isKeywords ? currentKeywords : (photo.title || "");
  const image = window.photosByElieMediaUrl?.(photo, "detail") || window.photosByElieMediaUrl?.(photo, "gallery") || "";
  dialog.innerHTML = `
    <form class="owner-metadata-modal-form" method="dialog">
      <h2>${title}</h2>
      ${image ? `
        <figure class="owner-metadata-modal-preview">
          <img src="${escapeHtml(image)}" alt="${escapeHtml(photo.title || title)}"/>
        </figure>
      ` : ""}
      <label>
        <span>${isKeywords ? "Keywords" : "Title"}</span>
        ${isKeywords
          ? `<textarea rows="4" data-owner-modal-field>${escapeHtml(value)}</textarea>`
          : `<input type="text" value="${escapeHtml(value)}" data-owner-modal-field/>`
        }
      </label>
      <div class="owner-metadata-modal-actions">
        <button class="btn secondary" type="button" data-owner-modal-cancel>Cancel</button>
        <button class="btn" type="submit">Save</button>
      </div>
    </form>
  `;
  const form = dialog.querySelector("form");
  const input = dialog.querySelector("[data-owner-modal-field]");
  const saveButton = dialog.querySelector("button[type='submit']");
  const closeWithoutSaving = () => {
    if (dialog.open) dialog.close("cancel");
  };
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeWithoutSaving();
  });
  dialog.querySelector("[data-owner-modal-cancel]")?.addEventListener("click", closeWithoutSaving);
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeWithoutSaving();
      return;
    }
    if (!["Enter", "Return"].includes(event.key) || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    if (!saveButton.disabled) form.requestSubmit();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (saveButton.disabled) return;
    saveButton.disabled = true;
    const titleValue = isKeywords ? (photo.title || "") : String(input.value || "").trim();
    const keywordValue = isKeywords
      ? uniqueKeywords(splitKeywordText(input.value)).join(", ")
      : currentKeywords;
    if (!titleValue) {
      saveButton.disabled = false;
      status.textContent = "Title cannot be empty.";
      input.focus();
      return;
    }
    const previousTitle = photo.title || "";
    const previousKeywords = currentKeywords;
    dialog.close("save");
    photo.title = titleValue;
    setMetadataValue(photo, "Metadata title", titleValue);
    setMetadataValue(photo, "Keywords", keywordValue);
    syncTitleUi();
    renderMetadataRows();
    status.textContent = "Saving metadata...";
    try {
      await hiddenActions.updatePhotoMetadata?.(photo.id, { title: titleValue, keywords: keywordValue });
      status.textContent = `${photo.title} metadata saved.`;
    } catch (error) {
      photo.title = previousTitle;
      setMetadataValue(photo, "Metadata title", previousTitle);
      setMetadataValue(photo, "Keywords", previousKeywords);
      syncTitleUi();
      renderMetadataRows();
      status.textContent = error?.message || "Could not save metadata.";
    }
  });
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  input?.focus();
  input?.select?.();
};

renderMetadataRows();

const preview = document.querySelector("[data-photo-preview]");
const detailLayout = document.querySelector(".detail-layout");
const isVideo = window.photosByElieIsVideo?.(photo) === true;
const isPanorama = !isVideo && Boolean(window.photosByEliePhotoIsPanorama?.(photo));
const syncDetailPreviewSize = () => {
  if (!detailLayout || !preview) return;
  if (preview.classList.contains("is-panorama")) {
    preview.style.setProperty("--detail-landscape-width", "100%");
    preview.style.removeProperty("--detail-portrait-width");
    return;
  }
  const ratio = Number(preview.style.getPropertyValue("--detail-ratio")) || 1.5;
  const maxWidth = detailLayout.clientWidth;
  const previewTop = Math.max(0, preview.getBoundingClientRect().top);
  const maxHeight = Math.max(280, window.innerHeight - previewTop - 24);
  const fittedWidth = Math.min(maxWidth, maxHeight * ratio);
  if (detailLayout.classList.contains("is-landscape")) {
    preview.style.setProperty("--detail-landscape-width", "100%");
    preview.style.removeProperty("--detail-portrait-width");
    return;
  }
  if (detailLayout.classList.contains("is-portrait")) {
    preview.style.setProperty("--detail-portrait-width", `${fittedWidth}px`);
    preview.style.removeProperty("--detail-landscape-width");
  }
};
const applyPreviewAspectRatio = (width, height) => {
  if (!width || !height) return;
  preview.style.setProperty("--detail-aspect", `${width} / ${height}`);
  preview.style.setProperty("--detail-ratio", width / height);
  detailLayout?.classList.toggle("is-landscape", width >= height);
  detailLayout?.classList.toggle("is-portrait", width < height);
  detailLayout?.classList.toggle("is-panorama", isPanorama);
  syncDetailPreviewSize();
  window.requestAnimationFrame(syncDetailPreviewSize);
};
preview.classList.add(collection.accent, photo.className);
preview.classList.toggle("is-panorama", isPanorama);
detailLayout?.classList.toggle("is-panorama", isPanorama);
const detailImageSrc = window.photosByElieMediaUrl?.(photo, "detail") || "";
if (detailImageSrc && isVideo) {
  preview.classList.add("has-image", "has-video");
  const video = document.createElement("video");
  video.src = detailImageSrc;
  video.poster = window.photosByElieVideoPosterUrl?.(photo) || "";
  video.controls = true;
  video.playsInline = true;
  video.preload = "metadata";
  const dimensions = window.photosByEliePreviewDimensions?.(photo);
  if (dimensions?.width && dimensions?.height) {
    applyPreviewAspectRatio(dimensions.width, dimensions.height);
  }
  const setVideoPreviewAspectRatio = () => applyPreviewAspectRatio(video.videoWidth, video.videoHeight);
  video.addEventListener("loadedmetadata", setVideoPreviewAspectRatio);
  if (video.readyState >= 1) setVideoPreviewAspectRatio();
  preview.prepend(video);
} else if (detailImageSrc) {
  preview.classList.add("has-image");
  const img = document.createElement("img");
  const setPreviewAspectRatio = () => {
    if (!img.naturalWidth || !img.naturalHeight) return;
    applyPreviewAspectRatio(img.naturalWidth, img.naturalHeight);
  };
  img.src = detailImageSrc;
  img.alt = photo.title;
  img.addEventListener("load", setPreviewAspectRatio);
  if (img.complete) setPreviewAspectRatio();
  preview.prepend(img);
}
if (isPanorama) {
  const panoToggle = document.createElement("button");
  panoToggle.className = "pano-scroll-toggle";
  panoToggle.type = "button";
  const panoPan = window.photosByElieEnableHorizontalPan?.(preview, {
    interactiveSelector: "a,button,input,select,textarea,label,video,[contenteditable='true'],[role='button'],.like-toggle",
  });
  const setPanoMode = (scrollMode) => {
    preview.classList.toggle("is-pano-scroll", scrollMode);
    panoToggle.classList.toggle("is-full-height-exit", scrollMode);
    if (scrollMode) document.body.append(panoToggle);
    else preview.append(panoToggle);
    panoToggle.textContent = t(scrollMode ? "preview.exit_full_height" : "preview.full_height");
    panoToggle.setAttribute("aria-label", t(scrollMode ? "preview.exit_full_height" : "preview.full_height"));
    panoToggle.setAttribute("aria-pressed", String(scrollMode));
    const syncScroll = () => {
      preview.scrollLeft = scrollMode ? Math.max(0, (preview.scrollWidth - preview.clientWidth) / 2) : 0;
      panoPan?.refresh?.();
    };
    window.requestAnimationFrame(syncScroll);
    window.setTimeout(syncScroll, 80);
    window.setTimeout(() => {
      panoPan?.refresh?.();
      if (scrollMode) panoPan?.startAutoPan?.({ delayMs: 1100, pixelsPerSecond: 22, fromCenter: true });
      else panoPan?.stopMotion?.();
    }, 120);
  };
  panoToggle.addEventListener("click", (event) => {
    event.stopPropagation();
    setPanoMode(!preview.classList.contains("is-pano-scroll"));
  });
  setPanoMode(false);
  preview.append(panoToggle);
}
window.addEventListener("resize", syncDetailPreviewSize);
const previewTitleTarget = preview.querySelector("[data-photo-preview-title]");
previewTitleTarget?.removeAttribute("data-i18n");
if (previewTitleTarget) previewTitleTarget.textContent = photo.title;

const setDetailBlockedVisual = (state = "") => {
  if (!preview) return;
  const blocking = state === "blocking";
  const blocked = state === "blocked";
  preview.classList.toggle("is-review-blocking", blocking);
  preview.classList.toggle("is-review-blocked", blocked);
};

const detailPreviewUsesOwnerSource = Boolean(localModerationEnabled || ownerReviewReturnContext || isOwnerReviewSyntheticCollection);
const detailPreviewItems = detailPhotos.map((entry) => entry.photo).filter(Boolean);
const openFullscreenPreview = () => {
  window.photosByElieOpenFinderPreview?.(photo, {
    owner: detailPreviewUsesOwnerSource,
    items: detailPreviewItems,
    index: Math.max(0, detailPreviewItems.findIndex((item) => item.id === photo.id)),
  });
};

preview.addEventListener("dblclick", (event) => {
  if (event.target instanceof Element && event.target.closest(".like-toggle")) return;
  if (event.target instanceof Element && event.target.closest(".pano-scroll-toggle")) return;
  openFullscreenPreview();
  event.preventDefault();
});
preview.addEventListener("contextmenu", (event) => {
  if (event.target instanceof Element && event.target.closest(".like-toggle")) return;
  if (event.target instanceof Element && event.target.closest(".pano-scroll-toggle")) return;
  window.photosByElieShowMediaContextMenu?.(photo, event, {
    owner: detailPreviewUsesOwnerSource,
    previewItems: detailPreviewItems,
    previewIndex: Math.max(0, detailPreviewItems.findIndex((item) => item.id === photo.id)),
  });
});
window.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key !== " ") return;
  if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, button, [contenteditable='true']")) return;
  openFullscreenPreview();
  event.preventDefault();
});

const syncLikeToggle = () => {
  if (likeToggle && likedStore) likeToggle.checked = likedStore.has(photo.id);
};

const toggleLike = () => {
  if (!likedStore) return;
  if (likedStore.has(photo.id)) {
    likedStore.remove(photo.id);
    syncLikeToggle();
    status.textContent = t("detail.removed_liked", { title: photo.title });
    return;
  }
  likedStore.add({ photoId: photo.id });
  syncLikeToggle();
  status.textContent = t("detail.added_liked", { title: photo.title });
};

if (likeToggle && likedStore) {
  syncLikeToggle();
  likeToggle.addEventListener("change", () => {
    toggleLike();
  });
}

const shouldIgnoreShortcut = (event) => {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return true;
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName);
};

window.addEventListener("keydown", (event) => {
  if (shouldIgnoreShortcut(event)) return;
  if (event.key.toLowerCase() === "l") {
    toggleLike();
    event.preventDefault();
    return;
  }
  if (event.key === "ArrowLeft" && previousPhotoHref) {
    navigateToPhotoHref(previousPhotoHref);
    event.preventDefault();
    return;
  }
  if (event.key === "ArrowRight" && nextPhotoHref) {
    navigateToPhotoHref(nextPhotoHref);
    event.preventDefault();
  }
});

const swipeTarget = document.querySelector(".detail-layout");
let swipeStart = null;
const isInteractiveSwipeTarget = (target) => (
  target instanceof Element
  && Boolean(target.closest("a,button,input,label,select,textarea,[contenteditable='true']"))
);
swipeTarget?.addEventListener("touchstart", (event) => {
  if (!window.matchMedia("(max-width: 760px)").matches) return;
  if (event.touches.length !== 1 || isInteractiveSwipeTarget(event.target)) return;
  const touch = event.touches[0];
  swipeStart = {
    x: touch.clientX,
    y: touch.clientY,
    time: Date.now()
  };
}, { passive: true });

swipeTarget?.addEventListener("touchend", (event) => {
  if (!swipeStart || !window.matchMedia("(max-width: 760px)").matches) {
    swipeStart = null;
    return;
  }
  const touch = event.changedTouches[0];
  const deltaX = touch.clientX - swipeStart.x;
  const deltaY = touch.clientY - swipeStart.y;
  const elapsed = Date.now() - swipeStart.time;
  swipeStart = null;
  if (elapsed > 650 || Math.abs(deltaX) < 52 || Math.abs(deltaX) < Math.abs(deltaY) * 1.35) return;
  if (deltaX < 0) {
    navigateToPhotoHref(nextPhotoHref);
    return;
  }
  navigateToPhotoHref(previousPhotoHref);
}, { passive: true });

if (ownerCullingEnabled) {
  window.addEventListener("keydown", async (event) => {
    if (shouldIgnoreShortcut(event)) return;
    const key = event.key.toLowerCase();
    if (key === "t" || key === "k") {
      if (!fullOwnerToolsEnabled) return;
      openOwnerMetadataModal(key === "k" ? "keywords" : "title");
      event.preventDefault();
      return;
    }
    if (key === "r") {
      if (!fullOwnerToolsEnabled) return;
      event.preventDefault();
      try {
        if (!hiddenActions.queueTitleKeywordReview) {
          throw new Error("Refresh Owner mode to load title/keyword review queueing.");
        }
        const result = await hiddenActions.queueTitleKeywordReview(photo.id, {
          source: "owner-detail-r",
          context: {
            view: "detail",
            collection_key: collectionKey,
            collection_title: collection?.title || "",
            photo_id: photo.id,
            url: window.location.pathname + window.location.search,
          },
        });
        status.textContent = result?.already_pending
          ? `${photo.title} is already in title/keyword review.`
          : `${photo.title} sent to title/keyword review.`;
      } catch (error) {
        status.textContent = error?.message || "Could not send photo to title/keyword review.";
      }
      return;
    }
    if (key === "x" || key === "b" || key === "h") {
      event.preventDefault();
      if (hiddenActions.has(photo.id)) {
        status.textContent = `${photo.title} is already in the Waste Basket.`;
        setDetailBlockedVisual("blocked");
        hiddenActions.mark(photo.id);
        navigateAwayFromBlockedPhoto();
        return;
      }
      try {
        setDetailBlockedVisual("blocking");
        status.textContent = `${photo.title} moving to Waste Basket...`;
        await hiddenActions.mark(photo.id);
        setDetailBlockedVisual("blocked");
        navigateAwayFromBlockedPhoto();
      } catch (error) {
        setDetailBlockedVisual("");
        status.textContent = error?.message || "Could not move photo to Waste Basket.";
      }
      return;
    }
    if (key !== "u") return;
    event.preventDefault();
    let undoneId = null;
    try {
      undoneId = await hiddenActions.undo(photo.id);
    } catch (error) {
      status.textContent = error?.message || "Could not undo the basket move.";
      return;
    }
    status.textContent = undoneId
      ? `${photo.title} moved back from Waste Basket.`
      : "No basketed photo to undo.";
  });
}

if (!ownerDetailPurchaseHidden) {
  const selectedIds = new Set((basketItemForPhoto()?.options || []).map((option) => option.id));
  const selectedOptionById = new Map((basketItemForPhoto()?.options || []).map((option) => [option.id, option]));
  const purchaseHeading = document.querySelector(".purchase-panel h2");
  if (isVideo && purchaseHeading) {
    purchaseHeading.removeAttribute("data-i18n");
    purchaseHeading.textContent = "Pick a video download";
  }
  const printConfigMarkup = (option) => {
    if (option.type !== "print") return "";
    const selected = selectedOptionById.get(option.id) || {};
    const quantity = window.photosByElieOptionQuantity?.(selected) || 1;
    const selectedFrameId = selected.frame?.id || "none";
    return `
      <div class="print-config">
        <label class="print-quantity">
          <span>${t("detail.count")}</span>
          <span class="quantity-stepper">
            <button type="button" data-print-step="${option.id}" data-step="-1" aria-label="${t("product.decrease_count", { label: productLabel(option) })}">-</button>
            <input type="number" min="1" max="99" step="1" data-print-quantity="${option.id}" value="${quantity}"/>
            <button type="button" data-print-step="${option.id}" data-step="1" aria-label="${t("product.increase_count", { label: productLabel(option) })}">+</button>
          </span>
        </label>
        <fieldset class="frame-options">
          <legend>${t("detail.frame")}</legend>
          ${frameOptions().map((frame) => `
            <label>
              <input type="radio" name="frame-${option.id}" data-print-frame="${option.id}" value="${frame.id}" ${frame.id === selectedFrameId ? "checked" : ""}/>
              <span>${frameLabel(frame)}${framePriceFor(frame, option) ? ` +${formatMoney(framePriceFor(frame, option))}` : ""}</span>
            </label>
          `).join("")}
        </fieldset>
      </div>
    `;
  };

  document.querySelector("[data-resolution-list]").innerHTML = availableResolutions.map((option) => `
    <div class="resolution-row product-row product-${option.type || "digital"}">
      <label class="product-choice">
        <input type="checkbox" data-resolution value="${option.id}" ${selectedIds.has(option.id) ? "checked" : ""}/>
        <span>
          <strong>${productLabel(option)}</strong>
        </span>
        <b>${formatMoney(option.price)}</b>
      </label>
      ${printConfigMarkup(option)}
    </div>
  `).join("");

  const syncSelectionToBasket = () => {
    const options = selectedOptions();
    const existing = basketItemForPhoto();
    basketStore.setPhotoOptions({
      photoId: photo.id,
      title: photo.title,
      collection: collection.title,
      options
    });
    updateTotal();
    if (!options.length) {
      status.textContent = existing ? t("detail.removed_basket", { title: photo.title }) : t("detail.no_selection");
      return;
    }
    status.textContent = t("detail.saved", { title: photo.title });
  };

  document.querySelectorAll("[data-resolution]").forEach((input) => {
    input.addEventListener("change", () => {
      syncSelectionToBasket();
    });
  });
  const selectPrintProduct = (optionId) => {
    const checkbox = document.querySelector(`[data-resolution][value="${optionId}"]`);
    if (checkbox) checkbox.checked = true;
  };
  document.querySelectorAll("[data-print-step]").forEach((button) => {
    button.addEventListener("click", () => {
      const optionId = button.dataset.printStep;
      const input = document.querySelector(`[data-print-quantity="${optionId}"]`);
      if (!input) return;
      const nextValue = Math.max(1, Math.min(99, (Number(input.value) || 1) + Number(button.dataset.step || 0)));
      input.value = nextValue;
      selectPrintProduct(optionId);
      syncSelectionToBasket();
    });
  });
  document.querySelectorAll("[data-print-quantity]").forEach((input) => {
    input.addEventListener("change", () => {
      selectPrintProduct(input.dataset.printQuantity);
      syncSelectionToBasket();
    });
    input.addEventListener("input", () => {
      selectPrintProduct(input.dataset.printQuantity);
      syncSelectionToBasket();
    });
  });
  document.querySelectorAll("[data-print-frame]").forEach((input) => {
    input.addEventListener("change", () => {
      selectPrintProduct(input.dataset.printFrame);
      syncSelectionToBasket();
    });
  });

  updateTotal();
}
}
})()).catch((error) => {
  const requestedCollectionKey = String(new URLSearchParams(window.location.search).get("gallery") || "").trim().toLowerCase();
  const isPBEOwnerFailure = requestedCollectionKey === "pbe-owner";
  if (isPBEOwnerFailure) document.body.dataset.gallery = "pbe-owner";
  document.querySelector("[data-photo-preview]")?.setAttribute("hidden", "");
  document.querySelector(".purchase-panel")?.setAttribute("hidden", "");
  document.querySelector("[data-detail-shortcut-hint]")?.setAttribute("hidden", "");
  const message = error?.message || (isPBEOwnerFailure ? "PBE Owner session is unavailable." : "Could not load photo.");
  const meta = document.querySelector("[data-photo-meta]");
  if (meta) {
    meta.removeAttribute("data-i18n");
    meta.textContent = isPBEOwnerFailure ? "PBE Owner unavailable" : "Photo unavailable";
  }
  const title = document.querySelector("[data-photo-title]");
  if (title) {
    title.removeAttribute("data-i18n");
    title.textContent = message;
  }
});
