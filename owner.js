(() => {
  const hiddenActions = window.photosByElieHiddenActions;
  const reserveStore = window.photosByElieReserve;
  const collections = window.photosByElieData || {};
  const controls = document.querySelector("[data-owner-controls]");
  const locked = document.querySelector("[data-owner-locked]");
  const status = document.querySelector("[data-owner-status]");
  const capInput = document.querySelector("[data-owner-regular-cap]");
  const saveCapButton = document.querySelector("[data-owner-save-cap]");
  const countsRoot = document.querySelector("[data-owner-counts]");
  const unknownCountRoot = document.querySelector("[data-owner-unknown-count]");
  const hiddenCountRoot = document.querySelector("[data-owner-hidden-count]");
  const syncCountryKeywordsButton = document.querySelector("[data-owner-sync-country-keywords]");

  const setStatus = (message) => {
    if (status) status.textContent = message;
  };

  const collectionCap = () => Math.max(
    1,
    ...Object.values(collections).map((collection) => collection.photos?.length || 0)
  );

  const currentCap = () => hiddenActions?.effectiveRegularCap?.() || collectionCap();

  const normalizedInputCap = () => {
    const rawValue = Number(capInput?.value || currentCap());
    return Math.max(1, Math.round(rawValue));
  };

  const saveCurrentCap = () => {
    const nextCap = normalizedInputCap();
    const savedCap = hiddenActions.setRegularCap(nextCap);
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
    const hidden = new Set(hiddenActions.read?.() || []);
    const assignments = hiddenActions.readCountryAssignments?.() || {};
    const photos = allUnknownPhotos();
    const visible = photos.filter((photo) => !hidden.has(photo.id) && !assignments[photo.id]);
    const assigned = photos.filter((photo) => assignments[photo.id]);
    return { photos, visible, assigned };
  };

  const renderCounts = () => {
    if (!countsRoot || !hiddenActions?.enabled) return;
    const hiddenCount = hiddenActions.read().length;
    const queue = unknownQueueState();
    if (unknownCountRoot) unknownCountRoot.textContent = String(queue.visible.length);
    if (hiddenCountRoot) hiddenCountRoot.textContent = String(hiddenCount);
    const counts = [
      ["Expo", countPhotos(collections)],
      ["Reserve", countPhotos(window.photosByElieReserveData || {})],
      ["Hidden", hiddenCount],
      ["Unknown queue", queue.visible.length],
      ["Unknown loaded", queue.photos.length],
      ["Unknown assigned", queue.assigned.length],
      ["Returned to Reserve", hiddenActions.readReserveOnly?.().length || 0],
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

  if (!hiddenActions?.enabled) {
    if (controls) controls.hidden = true;
    if (locked) locked.hidden = false;
    setStatus("Owner controls are locked on the public site.");
    return;
  }

  if (capInput) capInput.value = String(currentCap());

  saveCapButton?.addEventListener("click", () => {
    const savedCap = saveCurrentCap();
    setStatus(`Expo cap set to ${savedCap}.`);
  });

  syncCountryKeywordsButton?.addEventListener("click", async () => {
    syncCountryKeywordsButton.disabled = true;
    setStatus("Syncing collection keywords into local metadata and source files...");
    try {
      const result = await hiddenActions.syncCountryKeywords?.();
      const updates = result?.keyword_updates || {};
      const fileCount = updates.asset_updated || 0;
      const metadataCount = updates.metadata_changed || 0;
      const errorCount = updates.error_count || 0;
      renderCounts();
      setStatus(`Country keywords synced: ${metadataCount} catalog rows changed, ${fileCount} files updated${errorCount ? `, ${errorCount} file errors` : ""}.`);
    } catch (error) {
      setStatus(error?.message || "Could not sync country keywords.");
    } finally {
      syncCountryKeywordsButton.disabled = false;
    }
  });

  window.addEventListener("photosbyelie:hiddenchange", renderCounts);

  reserveStore?.load?.().then(() => {
    renderCounts();
  });
  renderCounts();
})();
