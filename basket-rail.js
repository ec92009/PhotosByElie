(() => {
  const basketStore = window.photosByElieBasket;
  const main = document.querySelector("main.shell");
  if (!basketStore || !main || document.body.matches("[data-basket-page]")) return;

  const formatMoney = (value) => `$${value}`;
  const t = (key, replacements = {}) => window.photosByElieI18n?.t?.(key, replacements) || key;
  const productLabel = (option) => {
    if (option?.type === "print") return window.photosByElieProductLabel?.(option) || option?.label || t("product.print");
    const keyById = {
      full: "product.full",
      "jpg-6mp": "product.jpg_6",
      "jpg-3mp": "product.jpg_3",
      "jpg-1mp": "product.jpg_1",
    };
    return t(keyById[option?.id] || "", {}) || option?.label || "";
  };
  const rail = document.createElement("aside");
  rail.className = "basket-rail";
  rail.setAttribute("aria-label", t("nav.basket"));
  main.classList.add("has-basket-rail");
  main.append(rail);

  const render = () => {
    const items = basketStore.read();
    const total = items.reduce((sum, item) => sum + (Number(item.total) || 0), 0);
    const lines = items.slice(0, 5).map((item) => {
      const options = (item.options || []).map(productLabel).join(", ") || t("detail.no_selection");
      const detailHref = `./photo.html?id=${encodeURIComponent(item.photoId)}`;
      return `
        <li class="basket-rail-item">
          <a class="basket-rail-item-link" href="${detailHref}" aria-label="Open ${item.title}">
            <span>${item.title}</span>
            <small>${options}</small>
            <strong>${formatMoney(Number(item.total) || 0)}</strong>
          </a>
        </li>
      `;
    }).join("");

    rail.innerHTML = `
      <div class="basket-rail-head">
        <p class="eyebrow">${t("nav.basket")}</p>
        <strong>${items.length} ${t(items.length === 1 ? "basket.item_singular" : "basket.item_plural")}</strong>
      </div>
      ${items.length ? `<ul class="basket-rail-list">${lines}</ul>` : `<p class="basket-rail-empty">${t("basket.empty")}</p>`}
      <div class="basket-rail-total">
        <span>${t("order.total")}</span>
        <strong>${formatMoney(total)}</strong>
      </div>
      <div class="basket-rail-actions">
        <a class="btn primary basket-rail-link" href="./basket.html">${t("nav.basket")}</a>
        <a class="btn secondary basket-rail-link" href="./liked.html">${t("nav.liked")}</a>
      </div>
    `;
  };

  window.addEventListener("photosbyelie:basketchange", render);
  window.addEventListener("photosbyelie:languagechange", render);
  window.addEventListener("storage", (event) => {
    if (event.key === "photosbyelie-basket") render();
  });
  render();
})();
