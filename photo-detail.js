((async () => {
if (window.photosByElieReserve?.enabled) {
  await window.photosByElieReserve.load();
}
if (window.photosByElieHidden?.enabled) {
  await window.photosByElieHidden.load();
}
await window.photosByElieHiddenBlacklistReady;
const params = new URLSearchParams(window.location.search);
const photoId = params.get("id") || "france-1";
const collections = window.photosByElieData || {};
const ownerCollections = window.photosByElieOwnerData || {};
const reserveCollections = window.photosByElieReserveData || {};
const hiddenCollections = window.photosByElieHiddenData || {};
const fallbackCollection = Object.values(collections).find((collection) => Array.isArray(collection.photos) && collection.photos.length)
  || collections.france
  || { title: "Gallery", accent: "", photos: [] };
const originalRegularCollectionEntry = Object.entries(collections).find(([, collection]) =>
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
const collectionEntry = regularCollectionEntry || reserveCollectionEntry || ownerCollectionEntry || hiddenCollectionEntry;
const isReserveCollection = Boolean(!regularCollectionEntry && reserveCollectionEntry);
const isOwnerCollection = Boolean(!regularCollectionEntry && !reserveCollectionEntry && ownerCollectionEntry);
const isHiddenCollection = Boolean(!regularCollectionEntry && !reserveCollectionEntry && !ownerCollectionEntry && hiddenCollectionEntry);
const [collectionKey, collection] = collectionEntry || ["france", fallbackCollection];
const photo = promotedPhoto || collection.photos.find((item) => item.id === photoId) || collection.photos[0] || null;
const photoIndex = photo ? collection.photos.findIndex((item) => item.id === photo.id) : -1;
const resolutions = window.photosByElieResolutions || [];
const availableResolutions = photo && window.photosByElieAvailableResolutions
  ? window.photosByElieAvailableResolutions(photo, resolutions)
  : resolutions;
const basketStore = window.photosByElieBasket;
const likedStore = window.photosByElieLiked;
const hiddenActions = window.photosByElieHiddenActions;
const localModerationEnabled = Boolean(hiddenActions?.enabled);
const versionedHref = (href) => window.photosByElieVersionedHref?.(href) || href;
const t = (key, replacements = {}) => window.photosByElieI18n?.t?.(key, replacements) || key;
const productLabel = (option) => {
  const keyById = {
    full: "product.full",
    "jpg-6mp": "product.jpg_6",
    "jpg-3mp": "product.jpg_3",
    "jpg-1mp": "product.jpg_1",
  };
  return t(keyById[option?.id] || (option?.type === "print" ? "product.print" : ""), {}) || window.photosByElieProductLabel?.(option) || option?.label || "";
};
const productDetail = (option) => {
  const detailKeyById = {
    "jpg-6mp": "product.jpg_6_detail",
    "jpg-3mp": "product.jpg_3_detail",
    "jpg-1mp": "product.jpg_1_detail",
  };
  if (detailKeyById[option?.id]) return t(detailKeyById[option.id]);
  if (option?.type === "print") return t("product.print_detail");
  const source = window.photosByElieOriginalSize?.(photo) || "";
  if (source) return t("product.original", { source });
  return t("product.full_detail");
};
const frameLabel = (frame) => ({
  none: t("product.no_frame"),
  white: t("product.white_frame"),
  black: t("product.black_frame"),
}[frame?.id] || frame?.label || "");
if (window.photosByElieIsPublicHidden?.(photo)) {
  window.location.replace(versionedHref(`./${collectionKey}.html`));
  return;
}
const detailSequenceKey = "photosbyelie-detail-sequence";
const metadataValue = (targetPhoto, label) => (
  (targetPhoto?.metadata || []).find((item) => item.label === label)?.value || ""
);
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
  const ownerShortcuts = localModerationEnabled
    ? [
      `${detailShortcutKey("H")} hide`,
      `${detailShortcutKey("U")} undo`
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
  try {
    const payload = JSON.parse(sessionStorage.getItem(detailSequenceKey) || "null");
    if (!payload || payload.source !== "gallery" || !Array.isArray(payload.photoIds)) return null;
    if (!payload.photoIds.includes(photo?.id)) return null;
    const byId = new Map(detailSequence().map((item) => [item.photo.id, item]));
    const ordered = payload.photoIds
      .map((id) => byId.get(id))
      .filter(Boolean);
    return ordered.some((item) => item.photo.id === photo.id) ? ordered : null;
  } catch {
    return null;
  }
};

const activeDetailSequence = () => galleryDetailSequence() || detailSequence();

const navigateAfterHide = () => {
  const remainingPhotos = visibleCollectionPhotos();
  if (!remainingPhotos.length) {
    const remainingSequence = activeDetailSequence().filter((item) => item.photo.id !== photo.id);
    window.location.replace(versionedHref(remainingSequence.length ? `./photo.html?id=${remainingSequence[0].photo.id}` : `./${collectionKey}.html`));
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
    const selected = { id: option.id, type: option.type || "digital", label: option.label, detail: option.detail, dimensions: option.dimensions, price: option.price };
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
  totalTarget.textContent = `$${total}`;
};

const basketItemForPhoto = () => basketStore.read().find((item) => item.photoId === photo.id);
const status = document.querySelector("[data-basket-status]");
const likeToggle = document.querySelector("[data-like-toggle]");

if (!photo) {
  document.title = `Photos By Elie | ${collection.title}`;
  document.querySelector("[data-nav-current]").textContent = collection.title;
  document.querySelector("[data-nav-current]").setAttribute("href", versionedHref(`./${collectionKey}.html`));
  document.querySelector("[data-photo-title]").textContent = t("detail.archive_reset_title");
  document.querySelector("[data-photo-meta]").textContent = t("detail.no_published_meta", { collection: collection.title });
  document.querySelector("[data-back-link]").setAttribute("href", versionedHref(`./${collectionKey}.html`));
  document.querySelector(".detail-cycle")?.setAttribute("hidden", "");
  document.querySelector("[data-resolution-list]").innerHTML = "";
  document.querySelector("[data-selection-total]").textContent = "$0";
  const metadataRoot = document.querySelector("[data-photo-metadata]");
  metadataRoot.hidden = true;
  const preview = document.querySelector("[data-photo-preview]");
  preview.classList.add(collection.accent);
  preview.querySelector("[data-photo-preview-title]").textContent = t("detail.no_published");
  if (status) status.textContent = t("detail.rebuilding");
} else {
if (localModerationEnabled && !visibleCollectionPhotos().some((item) => item.id === photo.id) && navigateAfterHide()) {
  // The currently requested photo is locally suppressed, so move to the next visible one immediately.
} else {
document.title = `Photos By Elie | ${photo.title}`;
document.querySelector("[data-nav-current]").textContent = collection.title;
document.querySelector("[data-nav-current]").setAttribute("href", versionedHref(`./${collectionKey}.html`));
document.querySelector("[data-photo-title]").textContent = photo.title;
document.querySelector("[data-photo-meta]").textContent = [
  collection.title,
  window.photosByElieSourceFormats ? window.photosByElieSourceFormats(photo) : photo.full,
  window.photosByElieVerifiedMegapixels && window.photosByElieVerifiedMegapixels(photo)
    ? t("detail.mp_verified", { mp: window.photosByElieVerifiedMegapixels(photo) })
    : ""
].filter(Boolean).join(" / ");
document.querySelector("[data-back-link]").setAttribute("href", versionedHref(`./${collectionKey}.html`));

const prevPhotoLink = document.querySelector("[data-prev-photo]");
const nextPhotoLink = document.querySelector("[data-next-photo]");
const navigateToPhotoLink = (link) => {
  const href = link?.getAttribute("href");
  if (href) window.location.assign(versionedHref(href));
};

const ensureDetailBottomActions = () => {
  const detailMain = document.querySelector(".detail-main");
  if (!detailMain || document.querySelector("[data-detail-bottom-actions]")) return;
  const bottomActions = document.createElement("nav");
  bottomActions.className = "panel mobile-bottom-actions detail-bottom-actions";
  bottomActions.dataset.detailBottomActions = "";
  bottomActions.setAttribute("aria-label", t("a11y.bottom_photo_actions"));
  bottomActions.innerHTML = `
    <a class="btn secondary" data-bottom-prev-photo href="./photo.html" data-i18n="common.previous">Previous</a>
    <a class="btn secondary" data-bottom-next-photo href="./photo.html" data-i18n="common.next">Next</a>
    <a class="btn secondary" data-bottom-back-link href="./${collectionKey}.html" data-i18n="common.back_to_gallery">Back to gallery</a>
  `;
  detailMain.append(bottomActions);
  window.photosByElieVersionInternalLinks?.(bottomActions);
  window.photosByElieI18n?.apply?.();
};

const syncDetailBottomActions = () => {
  ensureDetailBottomActions();
  const bottomActions = document.querySelector("[data-detail-bottom-actions]");
  if (!bottomActions) return;
  const bottomPrev = bottomActions.querySelector("[data-bottom-prev-photo]");
  const bottomNext = bottomActions.querySelector("[data-bottom-next-photo]");
  const bottomBack = bottomActions.querySelector("[data-bottom-back-link]");
  const prevHref = prevPhotoLink?.getAttribute("href");
  const nextHref = nextPhotoLink?.getAttribute("href");
  const backHref = document.querySelector("[data-back-link]")?.getAttribute("href") || `./${collectionKey}.html`;
  if (prevHref) bottomPrev?.setAttribute("href", versionedHref(prevHref));
  if (nextHref) bottomNext?.setAttribute("href", versionedHref(nextHref));
  if (bottomBack) bottomBack.setAttribute("href", versionedHref(backHref));
  bottomPrev?.toggleAttribute("hidden", !prevHref || document.querySelector(".detail-cycle")?.hasAttribute("hidden"));
  bottomNext?.toggleAttribute("hidden", !nextHref || document.querySelector(".detail-cycle")?.hasAttribute("hidden"));
};

if (prevPhotoLink && nextPhotoLink) {
  const detailPhotos = activeDetailSequence();
  const detailIndex = detailPhotos.findIndex((item) => item.photo.id === photo.id);
  if (detailPhotos.length > 1 && detailIndex >= 0) {
    const previousEntry = detailPhotos[(detailIndex - 1 + detailPhotos.length) % detailPhotos.length];
    const nextEntry = detailPhotos[(detailIndex + 1) % detailPhotos.length];
    prevPhotoLink.setAttribute("href", versionedHref(`./photo.html?id=${previousEntry.photo.id}`));
    prevPhotoLink.setAttribute("aria-label", `Previous photo: ${previousEntry.photo.title} in ${previousEntry.collection.title}`);
    nextPhotoLink.setAttribute("href", versionedHref(`./photo.html?id=${nextEntry.photo.id}`));
    nextPhotoLink.setAttribute("aria-label", `Next photo: ${nextEntry.photo.title} in ${nextEntry.collection.title}`);
  } else {
    document.querySelector(".detail-cycle")?.setAttribute("hidden", "");
  }
} else {
  document.querySelector(".detail-cycle")?.setAttribute("hidden", "");
}
syncDetailBottomActions();

const metadataRoot = document.querySelector("[data-photo-metadata]");
const renderMetadataRows = () => {
  const hiddenLabels = new Set(["preview file", "software", "color profile"]);
  const metadata = Array.isArray(photo.metadata)
    ? photo.metadata.filter((item) => item.label && item.value && !hiddenLabels.has(String(item.label).toLowerCase()))
    : [];
  metadataRoot.hidden = metadata.length === 0;
  metadataRoot.replaceChildren(...metadata.map((item) => {
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
  document.querySelector("[data-photo-title]").textContent = photo.title;
  document.querySelector("[data-photo-preview-title]").textContent = photo.title;
  document.querySelector("[data-photo-preview] img")?.setAttribute("alt", photo.title);
};

const ensureOwnerMetadataEditor = () => {
  if (!localModerationEnabled || document.querySelector("[data-owner-metadata-editor]")) return;
  const editor = document.createElement("form");
  editor.className = "owner-metadata-editor";
  editor.dataset.ownerMetadataEditor = "";
  editor.innerHTML = `
    <label>
      <span>Title</span>
      <input type="text" value="" data-owner-title/>
    </label>
    <label>
      <span>Keywords</span>
      <textarea rows="3" data-owner-keywords></textarea>
    </label>
    <button class="btn secondary" type="submit">Save metadata</button>
  `;
  const titleInput = editor.querySelector("[data-owner-title]");
  const keywordInput = editor.querySelector("[data-owner-keywords]");
  titleInput.value = photo.title || "";
  keywordInput.value = metadataValue(photo, "Keywords");
  const exitMetadataEditState = () => {
    if (document.activeElement === titleInput || document.activeElement === keywordInput) {
      document.activeElement.blur();
    }
  };
  [titleInput, keywordInput].forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      editor.requestSubmit();
    });
  });
  editor.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = editor.querySelector("button");
    button.disabled = true;
    try {
      const title = titleInput.value.trim();
      const keywords = uniqueKeywords(splitKeywordText(keywordInput.value)).join(", ");
      await hiddenActions.updatePhotoMetadata?.(photo.id, { title, keywords });
      photo.title = title;
      setMetadataValue(photo, "Metadata title", title);
      setMetadataValue(photo, "Keywords", keywords);
      syncTitleUi();
      renderMetadataRows();
      status.textContent = "";
    } catch (error) {
      status.textContent = error?.message || "Could not save metadata.";
    } finally {
      exitMetadataEditState();
      button.disabled = false;
    }
  });
  metadataRoot.before(editor);
};

renderMetadataRows();
ensureOwnerMetadataEditor();

const preview = document.querySelector("[data-photo-preview]");
const detailLayout = document.querySelector(".detail-layout");
let fullscreenPreview = null;
const syncLandscapePreviewSize = () => {
  if (!detailLayout?.classList.contains("is-landscape")) return;
  const ratio = Number(preview.style.getPropertyValue("--detail-ratio")) || 1.5;
  const maxWidth = detailLayout.clientWidth;
  const maxHeight = Math.max(320, window.innerHeight - 240);
  preview.style.setProperty("--detail-landscape-width", `${Math.min(maxWidth, maxHeight * ratio)}px`);
};
preview.classList.add(collection.accent, photo.className);
const detailImageSrc = window.photosByElieMediaUrl?.(photo, "detail") || "";
if (detailImageSrc) {
  preview.classList.add("has-image");
  const img = document.createElement("img");
  const setPreviewAspectRatio = () => {
    if (!img.naturalWidth || !img.naturalHeight) return;
    preview.style.setProperty("--detail-aspect", `${img.naturalWidth} / ${img.naturalHeight}`);
    preview.style.setProperty("--detail-ratio", img.naturalWidth / img.naturalHeight);
    detailLayout?.classList.toggle("is-landscape", img.naturalWidth >= img.naturalHeight);
    detailLayout?.classList.toggle("is-portrait", img.naturalWidth < img.naturalHeight);
    syncLandscapePreviewSize();
  };
  img.src = detailImageSrc;
  img.alt = photo.title;
  img.addEventListener("load", setPreviewAspectRatio);
  if (img.complete) setPreviewAspectRatio();
  preview.prepend(img);
}
window.addEventListener("resize", syncLandscapePreviewSize);
preview.querySelector("[data-photo-preview-title]").textContent = photo.title;

const closeFullscreenPreview = () => {
  fullscreenPreview?.remove();
  fullscreenPreview = null;
  document.body.classList.remove("detail-fullscreen-active");
};

const openFullscreenPreview = () => {
  const image = window.photosByElieMediaUrl?.(photo, "detail") || "";
  if (!image || fullscreenPreview) return;
  fullscreenPreview = document.createElement("div");
  fullscreenPreview.className = "detail-fullscreen-preview";
  fullscreenPreview.setAttribute("role", "button");
  fullscreenPreview.setAttribute("aria-label", t("detail.open_full_screen", { title: photo.title }));
  fullscreenPreview.tabIndex = 0;
  const fullscreenImage = document.createElement("img");
  fullscreenImage.src = image;
  fullscreenImage.alt = photo.title;
  fullscreenPreview.append(fullscreenImage);
  fullscreenPreview.addEventListener("click", closeFullscreenPreview);
  fullscreenPreview.addEventListener("dblclick", closeFullscreenPreview);
  fullscreenPreview.addEventListener("keydown", (event) => {
    if (!["Escape", "Enter", " "].includes(event.key)) return;
    closeFullscreenPreview();
    event.preventDefault();
  });
  document.body.append(fullscreenPreview);
  document.body.classList.add("detail-fullscreen-active");
  fullscreenPreview.focus({ preventScroll: true });
};

preview.addEventListener("dblclick", (event) => {
  if (event.target instanceof Element && event.target.closest(".like-toggle")) return;
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
  if (event.key === "ArrowLeft" && prevPhotoLink?.getAttribute("href")) {
    navigateToPhotoLink(prevPhotoLink);
    event.preventDefault();
    return;
  }
  if (event.key === "ArrowRight" && nextPhotoLink?.getAttribute("href")) {
    navigateToPhotoLink(nextPhotoLink);
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
    navigateToPhotoLink(nextPhotoLink);
    return;
  }
  navigateToPhotoLink(prevPhotoLink);
}, { passive: true });

if (localModerationEnabled) {
  window.addEventListener("keydown", async (event) => {
    if (shouldIgnoreShortcut(event)) return;
    const key = event.key.toLowerCase();
    if (key === "h") {
      if (hiddenActions.has(photo.id)) {
        status.textContent = `${photo.title} is already in Hidden.`;
        return;
      }
      try {
        await hiddenActions.mark(photo.id);
        navigateAfterHide();
      } catch (error) {
        status.textContent = error?.message || "Could not move photo to Hidden.";
      }
      return;
    }
    if (key !== "u") return;
    let undoneId = null;
    try {
      undoneId = await hiddenActions.undo(photo.id);
    } catch (error) {
      status.textContent = error?.message || "Could not undo the hide.";
      return;
    }
    status.textContent = undoneId
      ? `${photo.title} moved back from Hidden.`
      : "No hidden photo to undo.";
  });

  window.addEventListener("photosbyelie:hiddenchange", () => {
    navigateAfterHide();
  });
}

const selectedIds = new Set((basketItemForPhoto()?.options || []).map((option) => option.id));
const selectedOptionById = new Map((basketItemForPhoto()?.options || []).map((option) => [option.id, option]));
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
            <span>${frameLabel(frame)}${framePriceFor(frame, option) ? ` +$${framePriceFor(frame, option)}` : ""}</span>
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
        <small>${productDetail(option)}</small>
      </span>
      <b>$${option.price}</b>
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
})());
