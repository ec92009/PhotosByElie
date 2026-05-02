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
const basketCount = document.querySelector("[data-basket-count]");
const checkoutButton = document.querySelector("[data-checkout]");
const clearButton = document.querySelector("[data-clear-basket]");
const status = document.querySelector("[data-basket-status]");

const renderBasket = () => {
  const items = basketStore.write(basketStore.read());
  const total = items.reduce((sum, item) => sum + (Number(item.total) || 0), 0);

  basketCount.textContent = String(items.length);
  basketTotal.textContent = formatMoney(total);
  emptyState.hidden = items.length !== 0;
  checkoutButton.disabled = items.length === 0;
  clearButton.disabled = items.length === 0;

  basketRoot.innerHTML = items.map((item, index) => {
    const { collection, photo } = photoForItem(item);
    const thumbClasses = collection && photo ? `${collection.accent} ${photo.className}` : "";
    const imageSrc = photo?.imageSrc || "";
    const selectedIds = new Set((item.options || []).map((option) => option.id));
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
          ${resolutionOptions.map((option) => `
            <label>
              <input type="checkbox" data-basket-resolution="${index}" value="${option.id}" ${selectedIds.has(option.id) ? "checked" : ""}/>
              <span>${option.label}</span>
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
      status.textContent = `${item.title} license options updated.`;
      renderBasket();
    });
  });
};

clearButton.addEventListener("click", () => {
  basketStore.clear();
  status.textContent = "Basket cleared.";
  renderBasket();
});

checkoutButton.addEventListener("click", () => {
  const items = basketStore.read();
  if (!items.length) return;
  const summary = items.map((item) => {
    const options = (item.options || []).map((option) => option.label).join(", ");
    return `${item.collection}: ${item.title} (${options}) - ${formatMoney(Number(item.total) || 0)}`;
  }).join("\n");
  const subject = encodeURIComponent("Photos By Elie basket request");
  const body = encodeURIComponent(`Please prepare this photo order:\n\n${summary}\n\nTotal: ${basketTotal.textContent}`);
  window.location.href = `mailto:?subject=${subject}&body=${body}`;
});

renderBasket();
