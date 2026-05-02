(() => {
  const basketStore = window.photosByElieBasket;
  const main = document.querySelector("main.shell");
  if (!basketStore || !main || document.body.matches("[data-basket-page]")) return;

  const formatMoney = (value) => `$${value}`;
  const rail = document.createElement("aside");
  rail.className = "basket-rail";
  rail.setAttribute("aria-label", "Basket summary");
  main.classList.add("has-basket-rail");
  main.append(rail);

  const render = () => {
    const items = basketStore.read();
    const total = items.reduce((sum, item) => sum + (Number(item.total) || 0), 0);
    const lines = items.slice(0, 5).map((item) => {
      const options = (item.options || []).map((option) => option.label).join(", ") || "No resolution selected";
      return `
        <li class="basket-rail-item">
          <span>${item.title}</span>
          <small>${options}</small>
          <strong>${formatMoney(Number(item.total) || 0)}</strong>
        </li>
      `;
    }).join("");

    rail.innerHTML = `
      <div class="basket-rail-head">
        <p class="eyebrow">Basket</p>
        <strong>${items.length} item${items.length === 1 ? "" : "s"}</strong>
      </div>
      ${items.length ? `<ul class="basket-rail-list">${lines}</ul>` : `<p class="basket-rail-empty">No selections yet.</p>`}
      <div class="basket-rail-total">
        <span>Total</span>
        <strong>${formatMoney(total)}</strong>
      </div>
      <a class="btn primary basket-rail-link" href="./basket.html">Open basket</a>
    `;
  };

  window.addEventListener("photosbyelie:basketchange", render);
  window.addEventListener("storage", (event) => {
    if (event.key === "photosbyelie-basket") render();
  });
  render();
})();
