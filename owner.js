(() => {
  const hiddenActions = window.photosByElieHiddenActions;
  const reserveStore = window.photosByElieReserve;
  const collections = window.photosByElieData || {};
  const saveEndpoint = "/__photosbyelie/save-curation-pass";
  const controls = document.querySelector("[data-owner-controls]");
  const locked = document.querySelector("[data-owner-locked]");
  const status = document.querySelector("[data-owner-status]");
  const capInput = document.querySelector("[data-owner-regular-cap]");
  const saveCapButton = document.querySelector("[data-owner-save-cap]");
  const exportButton = document.querySelector("[data-owner-export]");
  const exportResult = document.querySelector("[data-owner-export-result]");
  const exportPath = document.querySelector("[data-owner-export-path]");
  const copyPathButton = document.querySelector("[data-owner-copy-path]");
  const exportText = document.querySelector("[data-owner-export-text]");
  const countsRoot = document.querySelector("[data-owner-counts]");
  const unknownCountRoot = document.querySelector("[data-owner-unknown-count]");
  const hiddenCountRoot = document.querySelector("[data-owner-hidden-count]");
  const syncCountryKeywordsButton = document.querySelector("[data-owner-sync-country-keywords]");
  const downloadRoot = "/Users/ecohen/Downloads";

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
    return Math.max(1, Math.min(100, Math.round(rawValue)));
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

  const showExportResult = () => {
    const curationPass = hiddenActions.readLastCurationPass?.();
    if (!curationPass?.filename || !curationPass?.text) return;
    const fullPath = curationPass.savedPath || `${downloadRoot}/${curationPass.filename}`;
    if (exportResult) exportResult.hidden = false;
    if (exportText) exportText.value = curationPass.text;
    if (exportPath) {
      exportPath.textContent = fullPath;
      exportPath.title = fullPath;
    }
  };

  const copyText = async (text) => {
    if (!text) return false;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // Browser permission prompts are inconsistent in embedded localhost tabs.
      }
    }
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.setAttribute("readonly", "");
    textArea.style.position = "fixed";
    textArea.style.top = "-1000px";
    textArea.style.left = "-1000px";
    document.body.append(textArea);
    textArea.focus();
    textArea.select();
    textArea.setSelectionRange(0, textArea.value.length);
    const copied = document.execCommand("copy");
    textArea.remove();
    return copied;
  };

  const saveCurationPassLocally = async (curationPass) => {
    if (!curationPass?.filename || !curationPass?.text) return null;
    try {
      const response = await fetch(saveEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: curationPass.filename,
          text: curationPass.text,
        }),
      });
      if (!response.ok) return null;
      const result = await response.json();
      if (!result?.ok || !result.path) return null;
      curationPass.savedPath = result.path;
      curationPass.savedBytes = result.bytes;
      return result;
    } catch {
      return null;
    }
  };

  if (!hiddenActions?.enabled) {
    if (controls) controls.hidden = true;
    if (locked) locked.hidden = false;
    setStatus("Owner controls are locked on the public site.");
    return;
  }

  if (capInput) capInput.value = String(currentCap());

  exportButton?.addEventListener("click", async () => {
    const exportedCap = saveCurrentCap();
    const filename = hiddenActions.exportCurationPass?.({ download: false }) || hiddenActions.exportBlacklist();
    const curationPass = hiddenActions.readLastCurationPass?.();
    const saved = await saveCurationPassLocally(curationPass);
    if (!saved) hiddenActions.downloadLastCurationPass?.();
    showExportResult();
    if (saved) {
      setStatus(`Batch JSON saved to Downloads with Expo cap ${exportedCap}.`);
    } else {
      setStatus(filename ? `${filename} downloaded with Expo cap ${exportedCap}.` : "Batch export unavailable.");
    }
    renderCounts();
  });

  copyPathButton?.addEventListener("click", async () => {
    const text = exportPath?.textContent || "";
    try {
      const copied = await copyText(text);
      setStatus(copied ? "Batch JSON path copied." : "Path copy unavailable.");
    } catch {
      setStatus("Path copy unavailable.");
    }
  });

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
