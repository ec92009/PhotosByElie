const formatMoney = (value) => `$${value}`;
const allCollections = window.photosByElieData || {};
window.photosByElieProductSettings?.applyPriceOverrides?.();
const resolutionOptions = window.photosByElieResolutions || [];
const basketStore = window.photosByElieBasket;
const likedStore = window.photosByElieLiked;
const frameOptions = () => window.photosByElieFrameOptions || [];
const framePriceFor = (frame, option) => window.photosByElieFramePrice?.(frame, option) || Number(frame?.price) || 0;
const optionQuantity = (option) => window.photosByElieOptionQuantity?.(option) || 1;
const optionTotal = (option) => window.photosByElieOptionTotal?.(option) || Number(option.price) || 0;
const t = (key, replacements = {}) => window.photosByElieI18n?.t?.(key, replacements) || key;
const escapeText = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;"
}[char]));

const photoForLikedItem = (item) => {
  const entry = Object.values(allCollections).find((collection) =>
    collection.photos.some((photo) => photo.id === item.photoId)
  );
  const photo = entry?.photos.find((candidate) => candidate.id === item.photoId);
  return { collection: entry, photo };
};

const likedRoot = document.querySelector("[data-liked-root]");
const emptyState = document.querySelector("[data-empty-liked]");
const likedTotal = document.querySelector("[data-liked-total]");
const status = document.querySelector("[data-liked-status]");
const bulkResolutionButtons = document.querySelectorAll("[data-liked-select-resolution]");
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
const productDetail = (photo, option) => {
  const detailKeyById = {
    "jpg-6mp": "product.jpg_6_detail",
    "jpg-3mp": "product.jpg_3_detail",
    "jpg-1mp": "product.jpg_1_detail",
  };
  if (detailKeyById[option?.id]) return t(detailKeyById[option.id]);
  if (option?.type === "print") return t("product.print_detail");
  const source = photo ? window.photosByElieOriginalSize?.(photo) || "" : "";
  if (source) return t("product.original", { source });
  return t("product.full_detail");
};
const frameLabel = (frame) => ({
  none: t("product.no_frame"),
  white: t("product.white_frame"),
  black: t("product.black_frame"),
}[frame?.id] || frame?.label || "");

const availableOptionsForPhoto = (photo) => photo && window.photosByElieAvailableResolutions
  ? window.photosByElieAvailableResolutions(photo, resolutionOptions)
  : resolutionOptions;

const bulkOptionLabel = (resolutionId) => ({
  full: t("product.full"),
  "jpg-6mp": "6 MP",
  "jpg-3mp": "3 MP",
  "jpg-1mp": "1 MP",
}[resolutionId] || productLabel(resolutionOptions.find((option) => option.id === resolutionId)));

const bulkResolutionState = (likedItems, basketByPhoto, resolutionId) => likedItems.reduce((state, item) => {
  const { photo } = photoForLikedItem(item);
  const targetOption = availableOptionsForPhoto(photo).find((option) => option.id === resolutionId);
  if (!targetOption) return state;
  state.eligible += 1;
  const selectedIds = new Set((basketByPhoto.get(item.photoId)?.options || []).map((option) => option.id));
  if (selectedIds.has(resolutionId)) state.selected += 1;
  return state;
}, { eligible: 0, selected: 0 });

const syncBulkResolutionButtons = (likedItems, basketByPhoto) => {
  bulkResolutionButtons.forEach((button) => {
    const resolutionId = button.dataset.likedSelectResolution;
    const state = bulkResolutionState(likedItems, basketByPhoto, resolutionId);
    const allSelected = state.eligible > 0 && state.selected === state.eligible;
    button.disabled = state.eligible === 0;
    button.setAttribute("aria-pressed", allSelected ? "true" : "false");
    button.textContent = t(allSelected ? "liked.deselect_all_option" : "liked.select_all_option", {
      option: bulkOptionLabel(resolutionId),
    });
  });
};

const optionPayload = (optionIds, photoId) => {
  const { photo } = photoForLikedItem({ photoId });
  const availableOptions = availableOptionsForPhoto(photo);
  return optionIds
    .map((item) => {
      const optionId = typeof item === "string" ? item : item.id;
      const option = availableOptions.find((candidate) => candidate.id === optionId);
      return option ? { option, source: item } : null;
    })
    .filter(Boolean)
    .map(({ option, source }) => {
      const payload = { id: option.id, type: option.type || "digital", label: option.label, detail: option.detail, dimensions: option.dimensions, price: option.price };
      if (payload.type === "print") {
        payload.quantity = source.quantity || 1;
        payload.frameId = source.frameId || "none";
      }
      return payload;
    });
};

const toggleResolutionForAllLiked = (resolutionId) => {
  const likedItems = likedStore.read();
  if (!likedItems.length) {
    status.textContent = t("liked.empty");
    return;
  }

  const basketByPhoto = new Map(basketStore.read().map((item) => [item.photoId, item]));
  const state = bulkResolutionState(likedItems, basketByPhoto, resolutionId);
  const shouldSelect = !(state.eligible > 0 && state.selected === state.eligible);
  let changedCount = 0;
  let unavailableCount = 0;
  likedItems.forEach((item) => {
    const { photo } = photoForLikedItem(item);
    const targetOption = availableOptionsForPhoto(photo).find((option) => option.id === resolutionId);
    if (!targetOption) {
      unavailableCount += 1;
      return;
    }

    const existing = basketStore.read().find((basketItem) => basketItem.photoId === item.photoId);
    const checkedIds = new Set((existing?.options || []).map((option) => option.id));
    if (shouldSelect) {
      checkedIds.add(resolutionId);
    } else {
      checkedIds.delete(resolutionId);
    }
    basketStore.setPhotoOptions({
      photoId: item.photoId,
      title: item.title,
      collection: item.collection,
      options: optionPayload([...checkedIds], item.photoId),
    });
    changedCount += 1;
  });

  const selectedOption = resolutionOptions.find((option) => option.id === resolutionId);
  const optionLabel = selectedOption ? productLabel(selectedOption) : "resolution";
  const statusKey = shouldSelect ? "liked.selected_some" : "liked.deselected_some";
  const allStatusKey = shouldSelect ? "liked.selected_all" : "liked.deselected_all";
  status.textContent = unavailableCount
    ? t(statusKey, { option: optionLabel, count: changedCount, unavailable: unavailableCount })
    : t(allStatusKey, { option: optionLabel, count: changedCount });
  renderLiked();
};

const renderLiked = () => {
  const likedItems = likedStore.write(likedStore.read());
  const basketItems = basketStore.read();
  const basketByPhoto = new Map(basketItems.map((item) => [item.photoId, item]));
  const rowSelections = likedItems.map((item) => basketByPhoto.get(item.photoId)?.options || []);
  const total = rowSelections.flat().reduce((sum, option) => sum + optionTotal(option), 0);
  const assetCount = rowSelections.reduce((sum, options) => sum + options.reduce((count, option) => count + optionQuantity(option), 0), 0);

  likedTotal.textContent = t("basket.assets_total", {
    count: assetCount,
    assetWord: t(assetCount === 1 ? "basket.asset_singular" : "basket.asset_plural"),
    total,
  });
  emptyState.hidden = likedItems.length !== 0;
  syncBulkResolutionButtons(likedItems, basketByPhoto);

  likedRoot.innerHTML = likedItems.map((item, index) => {
    const { collection, photo } = photoForLikedItem(item);
    const basketItem = basketByPhoto.get(item.photoId);
    const thumbClasses = collection && photo ? `${collection.accent} ${photo.className}` : "";
    const imageSrc = window.photosByElieMediaUrl?.(photo, "gallery") || "";
    const thumbStyle = window.photosByEliePhotoAspectStyle?.(photo) || "";
    const selectedIds = new Set((basketItem?.options || []).map((option) => option.id));
    const selectedOptionById = new Map((basketItem?.options || []).map((option) => [option.id, option]));
    const itemTotal = (basketItem?.options || []).reduce((sum, option) => sum + optionTotal(option), 0);
    const availableOptions = availableOptionsForPhoto(photo);
    const resolutionDetail = (option) => {
      if (!photo || !window.photosByElieResolutionDetail) return "";
      return `<small>${productDetail(photo, option)}</small>`;
    };
    const printConfigMarkup = (option) => {
      if (option.type !== "print") return "";
      const selected = selectedOptionById.get(option.id) || {};
      const selectedFrameId = selected.frame?.id || "none";
      return `
        <div class="print-config">
          <label class="print-quantity">
            <span>${t("detail.count")}</span>
            <span class="quantity-stepper">
              <button type="button" data-liked-print-step="${index}" data-option-id="${option.id}" data-step="-1" aria-label="${t("product.decrease_count", { label: productLabel(option) })}">-</button>
              <input type="number" min="1" max="99" step="1" data-liked-print-quantity="${index}" data-option-id="${option.id}" value="${optionQuantity(selected)}"/>
              <button type="button" data-liked-print-step="${index}" data-option-id="${option.id}" data-step="1" aria-label="${t("product.increase_count", { label: productLabel(option) })}">+</button>
            </span>
          </label>
          <fieldset class="frame-options">
            <legend>${t("detail.frame")}</legend>
            ${frameOptions().map((frame) => `
              <label>
                <input type="radio" name="liked-frame-${index}-${option.id}" data-liked-print-frame="${index}" data-option-id="${option.id}" value="${frame.id}" ${frame.id === selectedFrameId ? "checked" : ""}/>
                <span>${frameLabel(frame)}${framePriceFor(frame, option) ? ` +$${framePriceFor(frame, option)}` : ""}</span>
              </label>
            `).join("")}
          </fieldset>
        </div>
      `;
    };
    return `
    <article class="basket-item">
      <a class="basket-thumb liked-thumb mock-photo ${thumbClasses} ${imageSrc ? "has-image" : ""}" href="./photo.html?id=${item.photoId}" aria-label="Open ${item.title}"${thumbStyle}>
        ${imageSrc ? `<img src="${imageSrc}" alt="${item.title}"/>` : ""}
        <span>${item.title}</span>
      </a>
      <div>
        <p class="eyebrow">${item.collection || "Collection"}</p>
        <h3>${item.title}</h3>
        <div class="basket-resolution-grid" aria-label="Resolution options for ${item.title}">
          ${availableOptions.map((option) => `
            <div class="basket-product-row">
            <label class="product-choice">
              <input type="checkbox" data-liked-resolution="${index}" value="${option.id}" ${selectedIds.has(option.id) ? "checked" : ""}/>
              <span><strong>${productLabel(option)}</strong>${resolutionDetail(option)}</span>
              <b>${formatMoney(option.price)}</b>
            </label>
            ${printConfigMarkup(option)}
            </div>
          `).join("")}
        </div>
      </div>
      <div class="basket-item-actions">
        <strong>${formatMoney(itemTotal)}</strong>
        <button class="btn secondary" type="button" data-remove-liked="${index}">${t("liked.unlike")}</button>
      </div>
    </article>
  `}).join("");

  document.querySelectorAll("[data-remove-liked]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = likedStore.read()[Number(button.dataset.removeLiked)];
      if (!item) return;
      likedStore.remove(item.photoId);
      status.textContent = t("liked.removed", { title: item.title });
      renderLiked();
    });
  });

  const selectedOptionsFor = (itemIndex) => Array.from(document.querySelectorAll(`[data-liked-resolution="${itemIndex}"]:checked`))
    .map((checkbox) => {
      const option = resolutionOptions.find((item) => item.id === checkbox.value);
      if (!option) return null;
      const selected = { id: option.id };
      if (option.type === "print") {
        selected.quantity = document.querySelector(`[data-liked-print-quantity="${itemIndex}"][data-option-id="${option.id}"]`)?.value || 1;
        selected.frameId = document.querySelector(`[data-liked-print-frame="${itemIndex}"][data-option-id="${option.id}"]:checked`)?.value || "none";
      }
      return selected;
    })
    .filter(Boolean);

  const syncItemOptions = (itemIndex) => {
    const item = likedStore.read()[itemIndex];
    if (!item) return;
    const selectedOptions = selectedOptionsFor(itemIndex);
    basketStore.setPhotoOptions({
      photoId: item.photoId,
      title: item.title,
      collection: item.collection,
      options: optionPayload(selectedOptions, item.photoId),
    });
    status.textContent = selectedOptions.length
        ? t("liked.added_to_basket", { title: item.title })
        : t("liked.no_assets_selected", { title: item.title });
    renderLiked();
  };

  const selectPrintProduct = (itemIndex, optionId) => {
    const checkbox = document.querySelector(`[data-liked-resolution="${itemIndex}"][value="${optionId}"]`);
    if (checkbox) checkbox.checked = true;
  };

  document.querySelectorAll("[data-liked-resolution]").forEach((input) => {
    input.addEventListener("change", () => {
      syncItemOptions(Number(input.dataset.likedResolution));
    });
  });
  document.querySelectorAll("[data-liked-print-step]").forEach((button) => {
    button.addEventListener("click", () => {
      const itemIndex = Number(button.dataset.likedPrintStep);
      const optionId = button.dataset.optionId;
      const input = document.querySelector(`[data-liked-print-quantity="${itemIndex}"][data-option-id="${optionId}"]`);
      if (!input) return;
      input.value = Math.max(1, Math.min(99, (Number(input.value) || 1) + Number(button.dataset.step || 0)));
      selectPrintProduct(itemIndex, optionId);
      syncItemOptions(itemIndex);
    });
  });
  document.querySelectorAll("[data-liked-print-quantity]").forEach((input) => {
    input.addEventListener("change", () => {
      const itemIndex = Number(input.dataset.likedPrintQuantity);
      selectPrintProduct(itemIndex, input.dataset.optionId);
      syncItemOptions(itemIndex);
    });
    input.addEventListener("input", () => {
      const itemIndex = Number(input.dataset.likedPrintQuantity);
      selectPrintProduct(itemIndex, input.dataset.optionId);
      syncItemOptions(itemIndex);
    });
  });
  document.querySelectorAll("[data-liked-print-frame]").forEach((input) => {
    input.addEventListener("change", () => {
      const itemIndex = Number(input.dataset.likedPrintFrame);
      selectPrintProduct(itemIndex, input.dataset.optionId);
      syncItemOptions(itemIndex);
    });
  });
};

bulkResolutionButtons.forEach((button) => {
  button.addEventListener("click", () => {
    toggleResolutionForAllLiked(button.dataset.likedSelectResolution);
  });
});

renderLiked();
window.addEventListener("photosbyelie:languagechange", renderLiked);
