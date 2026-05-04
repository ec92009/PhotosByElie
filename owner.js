(() => {
  const unworthyStore = window.photosByElieUnworthy;
  const reserveStore = window.photosByElieReserve;
  const collections = window.photosByElieData || {};
  const controls = document.querySelector("[data-owner-controls]");
  const locked = document.querySelector("[data-owner-locked]");
  const status = document.querySelector("[data-owner-status]");
  const capInput = document.querySelector("[data-owner-regular-cap]");
  const saveCapButton = document.querySelector("[data-owner-save-cap]");
  const exportButton = document.querySelector("[data-owner-export]");
  const countsRoot = document.querySelector("[data-owner-counts]");

  const setStatus = (message) => {
    if (status) status.textContent = message;
  };

  const collectionCap = () => Math.max(
    1,
    ...Object.values(collections).map((collection) => collection.photos?.length || 0)
  );

  const currentCap = () => unworthyStore?.readRegularCap?.() || collectionCap();

  const countPhotos = (data) => Object.values(data || {})
    .reduce((sum, collection) => sum + (collection.photos?.length || 0), 0);

  const countPromotions = () => Object.values(reserveStore?.readPromotions?.() || {})
    .reduce((sum, ids) => sum + (Array.isArray(ids) ? ids.length : 0), 0);

  const renderCounts = () => {
    if (!countsRoot || !unworthyStore?.enabled) return;
    const counts = [
      ["Regular", countPhotos(collections)],
      ["Reserve", countPhotos(window.photosByElieReserveData || {})],
      ["Unworthy", unworthyStore.read().length],
      ["Returned to Reserve", unworthyStore.readReserveOnly?.().length || 0],
      ["Reserve replacements", countPromotions()],
      ["Gallery cap", currentCap()],
    ];
    countsRoot.innerHTML = counts.map(([label, value]) => `
      <div>
        <dt>${label}</dt>
        <dd>${value}</dd>
      </div>
    `).join("");
  };

  if (!unworthyStore?.enabled) {
    if (controls) controls.hidden = true;
    if (locked) locked.hidden = false;
    setStatus("Owner controls are locked on the public site.");
    return;
  }

  if (capInput) capInput.value = String(currentCap());

  exportButton?.addEventListener("click", () => {
    const filename = unworthyStore.exportBlacklist();
    setStatus(filename ? `${filename} downloaded.` : "Blacklist export unavailable.");
    renderCounts();
  });

  saveCapButton?.addEventListener("click", () => {
    const rawValue = Number(capInput?.value || 0);
    const nextCap = Math.max(1, Math.min(100, Math.round(rawValue)));
    const savedCap = unworthyStore.setRegularCap(nextCap);
    if (capInput) capInput.value = String(savedCap || nextCap);
    setStatus(`Regular gallery cap set to ${savedCap || nextCap}.`);
    renderCounts();
  });

  window.addEventListener("photosbyelie:unworthychange", renderCounts);

  reserveStore?.load?.().then(() => {
    renderCounts();
  });
  renderCounts();
})();
