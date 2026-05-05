const formatMoney = (value) => `$${value}`;
const allCollections = window.photosByElieData || {};
const resolutionOptions = window.photosByElieResolutions || [];
const basketStore = window.photosByElieBasket;
const likedStore = window.photosByElieLiked;
const frameOptions = () => window.photosByElieFrameOptions || [];
const framePriceFor = (frame, option) => window.photosByElieFramePrice?.(frame, option) || Number(frame?.price) || 0;
const optionQuantity = (option) => window.photosByElieOptionQuantity?.(option) || 1;
const optionTotal = (option) => window.photosByElieOptionTotal?.(option) || Number(option.price) || 0;

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

const availableOptionsForPhoto = (photo) => photo && window.photosByElieAvailableResolutions
  ? window.photosByElieAvailableResolutions(photo, resolutionOptions)
  : resolutionOptions;

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

const selectResolutionForAllLiked = (resolutionId) => {
  const likedItems = likedStore.read();
  if (!likedItems.length) {
    status.textContent = "No liked photos yet.";
    return;
  }

  let selectedCount = 0;
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
    checkedIds.add(resolutionId);
    basketStore.setPhotoOptions({
      photoId: item.photoId,
      title: item.title,
      collection: item.collection,
      options: optionPayload([...checkedIds], item.photoId),
    });
    selectedCount += 1;
  });

  const selectedOption = resolutionOptions.find((option) => option.id === resolutionId);
  const optionLabel = selectedOption ? window.photosByElieProductLabel?.(selectedOption) || selectedOption.label : "resolution";
  status.textContent = unavailableCount
    ? `${optionLabel} selected for ${selectedCount} liked photo(s); ${unavailableCount} unavailable.`
    : `${optionLabel} selected for ${selectedCount} liked photo(s).`;
  renderLiked();
};

const renderLiked = () => {
  const likedItems = likedStore.write(likedStore.read());
  const basketItems = basketStore.read();
  const basketByPhoto = new Map(basketItems.map((item) => [item.photoId, item]));
  const rowSelections = likedItems.map((item) => basketByPhoto.get(item.photoId)?.options || []);
  const total = rowSelections.flat().reduce((sum, option) => sum + optionTotal(option), 0);
  const productCount = rowSelections.reduce((sum, options) => sum + options.reduce((count, option) => count + optionQuantity(option), 0), 0);

  likedTotal.textContent = `${productCount} ${productCount === 1 ? "product" : "products"}, ${formatMoney(total)}`;
  emptyState.hidden = likedItems.length !== 0;
  bulkResolutionButtons.forEach((button) => {
    button.disabled = likedItems.length === 0;
  });

  likedRoot.innerHTML = likedItems.map((item, index) => {
    const { collection, photo } = photoForLikedItem(item);
    const basketItem = basketByPhoto.get(item.photoId);
    const thumbClasses = collection && photo ? `${collection.accent} ${photo.className}` : "";
    const imageSrc = photo?.gallerySrc || photo?.imageSrc || "";
    const selectedIds = new Set((basketItem?.options || []).map((option) => option.id));
    const selectedOptionById = new Map((basketItem?.options || []).map((option) => [option.id, option]));
    const itemTotal = (basketItem?.options || []).reduce((sum, option) => sum + optionTotal(option), 0);
    const availableOptions = availableOptionsForPhoto(photo);
    const resolutionDetail = (option) => {
      if (!photo || !window.photosByElieResolutionDetail) return "";
      return `<small>${window.photosByElieProductDetail ? window.photosByElieProductDetail(photo, option) : window.photosByElieResolutionDetail(photo, option)}</small>`;
    };
    const printConfigMarkup = (option) => {
      if (option.type !== "print") return "";
      const selected = selectedOptionById.get(option.id) || {};
      const selectedFrameId = selected.frame?.id || "none";
      return `
        <div class="print-config">
          <label class="print-quantity">
            <span>Count</span>
            <span class="quantity-stepper">
              <button type="button" data-liked-print-step="${index}" data-option-id="${option.id}" data-step="-1" aria-label="Decrease ${window.photosByElieProductLabel?.(option) || option.label} count">-</button>
              <input type="number" min="1" max="99" step="1" data-liked-print-quantity="${index}" data-option-id="${option.id}" value="${optionQuantity(selected)}"/>
              <button type="button" data-liked-print-step="${index}" data-option-id="${option.id}" data-step="1" aria-label="Increase ${window.photosByElieProductLabel?.(option) || option.label} count">+</button>
            </span>
          </label>
          <fieldset class="frame-options">
            <legend>Frame</legend>
            ${frameOptions().map((frame) => `
              <label>
                <input type="radio" name="liked-frame-${index}-${option.id}" data-liked-print-frame="${index}" data-option-id="${option.id}" value="${frame.id}" ${frame.id === selectedFrameId ? "checked" : ""}/>
                <span>${frame.label}${framePriceFor(frame, option) ? ` +$${framePriceFor(frame, option)}` : ""}</span>
              </label>
            `).join("")}
          </fieldset>
        </div>
      `;
    };
    return `
    <article class="basket-item">
      <a class="basket-thumb mock-photo ${thumbClasses} ${imageSrc ? "has-image" : ""}" href="./photo.html?id=${item.photoId}" aria-label="Open ${item.title}">
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
              <span><strong>${window.photosByElieProductLabel?.(option) || option.label}</strong>${resolutionDetail(option)}</span>
              <b>${formatMoney(option.price)}</b>
            </label>
            ${printConfigMarkup(option)}
            </div>
          `).join("")}
        </div>
      </div>
      <div class="basket-item-actions">
        <strong>${formatMoney(itemTotal)}</strong>
        <button class="btn secondary" type="button" data-remove-liked="${index}">Unlike</button>
      </div>
    </article>
  `}).join("");

  document.querySelectorAll("[data-remove-liked]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = likedStore.read()[Number(button.dataset.removeLiked)];
      if (!item) return;
      likedStore.remove(item.photoId);
      status.textContent = `${item.title} removed from liked photos.`;
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
        ? `${item.title} order products added to basket.`
        : `${item.title} has no selected order products.`;
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
    selectResolutionForAllLiked(button.dataset.likedSelectResolution);
  });
});

renderLiked();
