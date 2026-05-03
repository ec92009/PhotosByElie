const formatMoney = (value) => `$${value}`;
const allCollections = window.photosByElieData || {};
const resolutionOptions = window.photosByElieResolutions || [];
const basketStore = window.photosByElieBasket;
const likedStore = window.photosByElieLiked;

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

const optionPayload = (optionIds, photoId) => {
  const { photo } = photoForLikedItem({ photoId });
  const availableOptions = photo && window.photosByElieAvailableResolutions
    ? window.photosByElieAvailableResolutions(photo, resolutionOptions)
    : resolutionOptions;
  return optionIds
    .map((id) => availableOptions.find((option) => option.id === id))
    .filter(Boolean)
    .map((option) => ({ id: option.id, label: option.label, price: option.price }));
};

const renderLiked = () => {
  const likedItems = likedStore.write(likedStore.read());
  const basketItems = basketStore.read();
  const basketByPhoto = new Map(basketItems.map((item) => [item.photoId, item]));
  const rowSelections = likedItems.map((item) => basketByPhoto.get(item.photoId)?.options || []);
  const total = rowSelections.flat().reduce((sum, option) => sum + (Number(option.price) || 0), 0);
  const fileCount = rowSelections.reduce((sum, options) => sum + options.length, 0);

  likedTotal.textContent = `${fileCount} ${fileCount === 1 ? "file" : "files"}, ${formatMoney(total)}`;
  emptyState.hidden = likedItems.length !== 0;

  likedRoot.innerHTML = likedItems.map((item, index) => {
    const { collection, photo } = photoForLikedItem(item);
    const basketItem = basketByPhoto.get(item.photoId);
    const thumbClasses = collection && photo ? `${collection.accent} ${photo.className}` : "";
    const imageSrc = photo?.imageSrc || "";
    const selectedIds = new Set((basketItem?.options || []).map((option) => option.id));
    const itemTotal = (basketItem?.options || []).reduce((sum, option) => sum + (Number(option.price) || 0), 0);
    const availableOptions = photo && window.photosByElieAvailableResolutions
      ? window.photosByElieAvailableResolutions(photo, resolutionOptions)
      : resolutionOptions;
    const resolutionDetail = (option) => {
      if (!photo || !window.photosByElieResolutionDetail) return "";
      return option.id === "full" ? `<small>${window.photosByElieResolutionDetail(photo, option)}</small>` : "";
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
              <input type="checkbox" data-liked-resolution="${index}" value="${option.id}" ${selectedIds.has(option.id) ? "checked" : ""}/>
              <span><strong>${option.label}</strong>${resolutionDetail(option)}</span>
              <b>${formatMoney(option.price)}</b>
            </label>
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

  document.querySelectorAll("[data-liked-resolution]").forEach((input) => {
    input.addEventListener("change", () => {
      const itemIndex = Number(input.dataset.likedResolution);
      const item = likedStore.read()[itemIndex];
      if (!item) return;
      const checkedIds = Array.from(document.querySelectorAll(`[data-liked-resolution="${itemIndex}"]:checked`))
        .map((checkbox) => checkbox.value);
      basketStore.setPhotoOptions({
        photoId: item.photoId,
        title: item.title,
        collection: item.collection,
        options: optionPayload(checkedIds, item.photoId),
      });
      status.textContent = checkedIds.length
        ? `${item.title} license options added to basket.`
        : `${item.title} has no selected license files.`;
      renderLiked();
    });
  });
};

renderLiked();
