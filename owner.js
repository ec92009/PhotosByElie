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
  const exportResult = document.querySelector("[data-owner-export-result]");
  const exportLink = document.querySelector("[data-owner-export-link]");
  const exportText = document.querySelector("[data-owner-export-text]");
  const countsRoot = document.querySelector("[data-owner-counts]");
  const unknownCountRoot = document.querySelector("[data-owner-unknown-count]");
  const unworthyCountRoot = document.querySelector("[data-owner-unworthy-count]");

  const setStatus = (message) => {
    if (status) status.textContent = message;
  };

  const collectionCap = () => Math.max(
    1,
    ...Object.values(collections).map((collection) => collection.photos?.length || 0)
  );

  const currentCap = () => unworthyStore?.effectiveRegularCap?.() || collectionCap();

  const normalizedInputCap = () => {
    const rawValue = Number(capInput?.value || currentCap());
    return Math.max(1, Math.min(100, Math.round(rawValue)));
  };

  const saveCurrentCap = () => {
    const nextCap = normalizedInputCap();
    const savedCap = unworthyStore.setRegularCap(nextCap);
    const resolvedCap = savedCap || nextCap;
    if (capInput) capInput.value = String(resolvedCap);
    renderCounts();
    return resolvedCap;
  };

  const countPhotos = (data) => Object.values(data || {})
    .reduce((sum, collection) => sum + (collection.photos?.length || 0), 0);

  const countPromotions = () => Object.values(reserveStore?.readPromotions?.() || {})
    .reduce((sum, ids) => sum + (Array.isArray(ids) ? ids.length : 0), 0);

  const allUnknownPhotos = () => {
    const regular = window.photosByElieOwnerData?.unknown?.photos || [];
    const reserve = window.photosByElieReserveData?.unknown?.photos || [];
    const byId = new Map();
    regular.concat(reserve).forEach((photo) => {
      if (!byId.has(photo.id)) byId.set(photo.id, photo);
    });
    return [...byId.values()];
  };

  const unknownQueueState = () => {
    const hidden = new Set(unworthyStore.read?.() || []);
    const assignments = unworthyStore.readCountryAssignments?.() || {};
    const photos = allUnknownPhotos();
    const visible = photos.filter((photo) => !hidden.has(photo.id) && !assignments[photo.id]);
    const assigned = photos.filter((photo) => assignments[photo.id]);
    return { photos, visible, assigned };
  };

  const renderCounts = () => {
    if (!countsRoot || !unworthyStore?.enabled) return;
    const unworthyCount = unworthyStore.read().length;
    const queue = unknownQueueState();
    if (unknownCountRoot) unknownCountRoot.textContent = String(queue.visible.length);
    if (unworthyCountRoot) unworthyCountRoot.textContent = String(unworthyCount);
    const counts = [
      ["Expo", countPhotos(collections)],
      ["Reserve", countPhotos(window.photosByElieReserveData || {})],
      ["Hidden", unworthyCount],
      ["Unknown queue", queue.visible.length],
      ["Unknown loaded", queue.photos.length],
      ["Unknown assigned", queue.assigned.length],
      ["Returned to Reserve", unworthyStore.readReserveOnly?.().length || 0],
      ["Reserve replacements", countPromotions()],
      ["Expo cap", currentCap()],
    ];
    countsRoot.innerHTML = counts.map(([label, value]) => `
      <div>
        <dt>${label}</dt>
        <dd>${value}</dd>
      </div>
    `).join("");
  };

  const showExportResult = () => {
    const curationPass = unworthyStore.readLastCurationPass?.();
    if (!curationPass?.filename || !curationPass?.text) return;
    if (exportResult) exportResult.hidden = false;
    if (exportText) exportText.value = curationPass.text;
    if (exportLink) {
      exportLink.href = curationPass.url || "#";
      exportLink.download = curationPass.filename;
      exportLink.textContent = curationPass.filename;
    }
  };

  if (!unworthyStore?.enabled) {
    if (controls) controls.hidden = true;
    if (locked) locked.hidden = false;
    setStatus("Owner controls are locked on the public site.");
    return;
  }

  if (capInput) capInput.value = String(currentCap());

  exportButton?.addEventListener("click", () => {
    const exportedCap = saveCurrentCap();
    const filename = unworthyStore.exportCurationPass?.() || unworthyStore.exportBlacklist();
    showExportResult();
    setStatus(filename ? `${filename} downloaded with Expo cap ${exportedCap}.` : "Curation Pass export unavailable.");
    renderCounts();
  });

  saveCapButton?.addEventListener("click", () => {
    const savedCap = saveCurrentCap();
    setStatus(`Expo cap set to ${savedCap}.`);
  });

  window.addEventListener("photosbyelie:unworthychange", renderCounts);

  reserveStore?.load?.().then(() => {
    renderCounts();
  });
  renderCounts();
})();
