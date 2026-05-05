const formatMoney = (value) => `$${value}`;
const allCollections = window.photosByElieData || {};
const resolutionOptions = window.photosByElieResolutions || [];
const basketStore = window.photosByElieBasket;

const photoForItem = (item) => {
  const entry = Object.values(allCollections).find((collection) =>
    collection.photos.some((photo) => photo.id === item.photoId)
  );
  const photo = entry?.photos.find((candidate) => candidate.id === item.photoId);
  return { collection: entry, photo };
};

const basketRoot = document.querySelector("[data-basket-root]");
const emptyState = document.querySelector("[data-empty-basket]");
const basketTotal = document.querySelector("[data-basket-total]");
const status = document.querySelector("[data-basket-status]");
const orderIntent = document.querySelector("[data-order-intent]");
const orderSummary = document.querySelector("[data-order-summary]");
const orderEmail = document.querySelector("[data-order-email]");

const escapeText = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;"
}[char]));

const productTypeLabel = (option) => ({
  digital: "Digital",
  print: "Print",
  frame: "Frame"
}[option?.type] || "Product");

const productDetail = (photo, option) => {
  if (!photo || !window.photosByElieProductDetail) return option.detail || "";
  return window.photosByElieProductDetail(photo, option) || option.detail || "";
};

const photoReviewUrl = (photoId) => {
  const href = window.photosByElieVersionedHref?.(`./photo.html?id=${encodeURIComponent(photoId)}`)
    || `./photo.html?id=${encodeURIComponent(photoId)}`;
  return new URL(href, window.location.href).href;
};

const syncOrderIntent = (items, productCount, total) => {
  if (!orderIntent || !orderSummary || !orderEmail) return;
  orderIntent.hidden = items.length === 0;
  if (!items.length) return;

  const collectionCounts = items.reduce((counts, item) => {
    const key = item.collection || "Collection";
    counts.set(key, (counts.get(key) || 0) + 1);
    return counts;
  }, new Map());
  const collectionText = Array.from(collectionCounts.entries())
    .map(([name, count]) => `${name}: ${count}`)
    .join(", ");

  orderSummary.innerHTML = `
    <div><dt>Photos</dt><dd>${items.length}</dd></div>
    <div><dt>Products</dt><dd>${productCount}</dd></div>
    <div><dt>Draft total</dt><dd>${formatMoney(total)}</dd></div>
    <div><dt>Collections</dt><dd>${escapeText(collectionText)}</dd></div>
  `;

  const lines = [
    "Photos By Elie order intent",
    "",
    `Photos: ${items.length}`,
    `Products: ${productCount}`,
    `Draft total: ${formatMoney(total)}`,
    "",
    ...items.flatMap((item, index) => {
      const { photo } = photoForItem(item);
      const subtotal = (item.options || []).reduce((sum, option) => sum + (Number(option.price) || 0), 0);
      return [
        `${index + 1}. ${item.title}`,
        `Collection: ${item.collection}`,
        `Review page: ${photoReviewUrl(item.photoId)}`,
        `Source: ${photo ? window.photosByElieOriginalSize?.(photo) || "Source file unverified" : "Photo no longer in public catalog"}`,
        "Selected products:",
        ...item.options.map((option) => `- [${productTypeLabel(option)}] ${option.label}: ${formatMoney(option.price)}${productDetail(photo, option) ? ` (${productDetail(photo, option)})` : ""}`),
        `Photo subtotal: ${formatMoney(subtotal)}`,
        ""
      ];
    }),
    "License note: personal print and web use are included by default. Print crops, frame choices, commercial, resale, and AI-training use are confirmed manually before fulfillment."
  ];
  orderEmail.setAttribute("href", `mailto:?subject=${encodeURIComponent("Photos By Elie order intent")}&body=${encodeURIComponent(lines.join("\n"))}`);
};

const renderBasket = () => {
  const items = basketStore.write(basketStore.read());
  const total = items.reduce((sum, item) => sum + (Number(item.total) || 0), 0);
  const productCount = items.reduce((sum, item) => sum + (item.options || []).length, 0);

  basketTotal.textContent = `${productCount} ${productCount === 1 ? "product" : "products"}, ${formatMoney(total)}`;
  emptyState.hidden = items.length !== 0;
  syncOrderIntent(items, productCount, total);

  basketRoot.innerHTML = items.map((item, index) => {
    const { collection, photo } = photoForItem(item);
    const thumbClasses = collection && photo ? `${collection.accent} ${photo.className}` : "";
    const imageSrc = photo?.gallerySrc || photo?.imageSrc || "";
    const selectedIds = new Set((item.options || []).map((option) => option.id));
    const availableOptions = photo && window.photosByElieAvailableResolutions
      ? window.photosByElieAvailableResolutions(photo, resolutionOptions)
      : resolutionOptions;
    const resolutionDetail = (option) => {
      if (!photo || !window.photosByElieProductDetail) return "";
      return `<small>${window.photosByElieProductDetail(photo, option)}</small>`;
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
            <label>
              <input type="checkbox" data-basket-resolution="${index}" value="${option.id}" ${selectedIds.has(option.id) ? "checked" : ""}/>
              <span><strong>${option.label}</strong>${resolutionDetail(option)}</span>
              <b>${formatMoney(option.price)}</b>
            </label>
          `).join("")}
        </div>
      </div>
      <div class="basket-item-actions">
        <strong>${formatMoney(Number(item.total) || 0)}</strong>
        <button class="btn secondary" type="button" data-remove-item="${index}">Remove</button>
      </div>
    </article>
  `}).join("");

  document.querySelectorAll("[data-remove-item]").forEach((button) => {
    button.addEventListener("click", () => {
      basketStore.remove(Number(button.dataset.removeItem));
      status.textContent = "Item removed from basket.";
      renderBasket();
    });
  });

  document.querySelectorAll("[data-basket-resolution]").forEach((input) => {
    input.addEventListener("change", () => {
      const itemIndex = Number(input.dataset.basketResolution);
      const item = basketStore.read()[itemIndex];
      if (!item) return;
      const checkedIds = Array.from(document.querySelectorAll(`[data-basket-resolution="${itemIndex}"]:checked`))
        .map((checkbox) => checkbox.value);
      basketStore.updateOptions(itemIndex, checkedIds);
      status.textContent = checkedIds.length
        ? `${item.title} order products updated.`
        : `${item.title} has no selected order products. Use Remove to delete the photo.`;
      renderBasket();
    });
  });
};

renderBasket();
