(() => {
  const hiddenActions = window.photosByElieHiddenActions;
  const reserveStore = window.photosByElieReserve;
  const collections = window.photosByElieData || {};
  const controls = document.querySelector("[data-owner-controls]");
  const locked = document.querySelector("[data-owner-locked]");
  const status = document.querySelector("[data-owner-status]");
  const countsRoot = document.querySelector("[data-owner-counts]");
  const unknownCountRoot = document.querySelector("[data-owner-unknown-count]");
  const hiddenCountRoot = document.querySelector("[data-owner-hidden-count]");
  const syncCountryKeywordsButton = document.querySelector("[data-owner-sync-country-keywords]");
  const publishHiddenBlacklistButton = document.querySelector("[data-owner-publish-hidden-blacklist]");
  const wipeHiddenR2Button = document.querySelector("[data-owner-wipe-hidden-r2]");
  const physicalProductsToggle = document.querySelector("[data-owner-physical-products]");
  const r2Card = document.querySelector("[data-owner-r2-card]");
  const r2Summary = document.querySelector("[data-owner-r2-summary]");
  const r2Counts = document.querySelector("[data-owner-r2-counts]");
  const productSettings = window.photosByElieProductSettings;
  let r2PollTimer = null;

  const setStatus = (message) => {
    if (status) status.textContent = message;
  };

  const countPhotos = (data) => Object.values(data || {})
    .reduce((sum, collection) => sum + (collection.photos?.length || 0), 0);

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

  const formatBytes = (value) => {
    const bytes = Number(value || 0);
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }
    return `${size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
  };

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
      ["Local preview cache", countPhotos(window.photosByElieReserveData || {})],
      ["Hidden", hiddenCount],
      ["Unknown queue", queue.visible.length],
      ["Unknown loaded", queue.photos.length],
      ["Unknown assigned", queue.assigned.length],
    ];
    countsRoot.innerHTML = counts.map(([label, value]) => `
      <div>
        <dt>${label}</dt>
        <dd>${value}</dd>
      </div>
    `).join("");
  };

  const renderR2Progress = (tasks = []) => {
    if (!r2Card || !r2Summary || !r2Counts) return;
    const latest = tasks[0];
    if (!latest) {
      r2Card.hidden = true;
      r2Counts.innerHTML = "";
      return;
    }
    r2Card.hidden = false;
    const total = Number(latest.total || 0);
    const completed = Number(latest.completed || 0);
    const failed = Number(latest.failed || 0);
    const active = latest.state === "queued" || latest.state === "running";
    const isDelete = latest.operation === "delete";
    if (active) {
      r2Summary.textContent = `${isDelete ? "Deleting" : "Uploading"} R2 updates: ${completed}/${total} files, ${failed} failed.`;
    } else if (failed) {
      r2Summary.textContent = `R2 ${isDelete ? "delete" : "upload"} needs attention: ${failed}/${total} files failed.`;
    } else {
      r2Summary.textContent = `Last R2 ${isDelete ? "delete" : "upload"} finished: ${completed} files.`;
    }
    const rows = [
      ["State", latest.state || "unknown"],
      ["Work", latest.kind || "background"],
      ["Photo", latest.photo_id || "metadata"],
      ["Files", `${completed}/${total}`],
      ["Failed", failed],
      ["Uploaded", `${formatBytes(latest.bytes_done)} / ${formatBytes(latest.bytes_total)}`],
    ];
    r2Counts.innerHTML = rows.map(([label, value]) => `
      <div>
        <dt>${escapeHtml(label)}</dt>
        <dd>${escapeHtml(value)}</dd>
      </div>
    `).join("");
  };

  const loadR2Progress = async () => {
    if (!r2Card || !hiddenActions?.enabled) return;
    try {
      const response = await fetch("/__photosbyelie/r2-progress", { cache: "no-store" });
      if (!response.ok) throw new Error(`R2 progress ${response.status}`);
      const payload = await response.json();
      const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
      renderR2Progress(tasks);
    } catch {
      renderR2Progress([]);
    }
  };

  const startR2Polling = () => {
    if (r2PollTimer || !hiddenActions?.enabled) return;
    loadR2Progress();
    r2PollTimer = window.setInterval(loadR2Progress, 3000);
  };

  if (!hiddenActions?.enabled) {
    if (controls) controls.hidden = true;
    if (locked) locked.hidden = false;
    setStatus("Owner controls are locked on the public site.");
    return;
  }

  if (physicalProductsToggle) {
    physicalProductsToggle.checked = productSettings?.physicalProductsEnabled?.() === true;
  }

  physicalProductsToggle?.addEventListener("change", () => {
    const enabled = productSettings?.setPhysicalProductsEnabled?.(physicalProductsToggle.checked) === true;
    physicalProductsToggle.checked = enabled;
    setStatus(enabled
      ? "Physical print and frame products are visible on localhost."
      : "Physical print and frame products are hidden; the site is digital-only."
    );
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
      loadR2Progress();
      setStatus(`Country keywords synced: ${metadataCount} catalog rows changed, ${fileCount} files updated${errorCount ? `, ${errorCount} file errors` : ""}.`);
    } catch (error) {
      setStatus(error?.message || "Could not sync country keywords.");
    } finally {
      syncCountryKeywordsButton.disabled = false;
    }
  });

  publishHiddenBlacklistButton?.addEventListener("click", async () => {
    publishHiddenBlacklistButton.disabled = true;
    setStatus("Syncing the hidden-photo list to R2...");
    try {
      await hiddenActions.publishHiddenBlacklist?.();
      renderCounts();
      loadR2Progress();
      setStatus("Hidden list sync queued for R2.");
    } catch (error) {
      setStatus(error?.message || "Could not publish hidden blacklist.");
    } finally {
      publishHiddenBlacklistButton.disabled = false;
    }
  });

  wipeHiddenR2Button?.addEventListener("click", async () => {
    const ok = window.confirm("Delete public preview objects for hidden photos? Publish the hidden list first so galleries know these photos are rejected.");
    if (!ok) return;
    wipeHiddenR2Button.disabled = true;
    setStatus("Queueing hidden public preview deletes in R2...");
    try {
      await hiddenActions.wipeHiddenR2?.();
      renderCounts();
      loadR2Progress();
      setStatus("Hidden public preview wipe queued.");
    } catch (error) {
      setStatus(error?.message || "Could not queue hidden public preview wipe.");
    } finally {
      wipeHiddenR2Button.disabled = false;
    }
  });

  window.addEventListener("photosbyelie:hiddenchange", renderCounts);

  reserveStore?.load?.().then(() => {
    renderCounts();
  });
  renderCounts();
  startR2Polling();
})();
