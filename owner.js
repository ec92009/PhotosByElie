(() => {
  const ownerAuth = window.photosByElieOwnerAuth;
  const hiddenActions = window.photosByElieHiddenActions;
  const reserveStore = window.photosByElieReserve;
  const collections = window.photosByElieData || {};
  const controls = document.querySelector("[data-owner-controls]");
  const locked = document.querySelector("[data-owner-locked]");
  const status = document.querySelector("[data-owner-status]");
  const authPanel = document.querySelector("[data-owner-auth-panel]");
  const authHeading = document.querySelector("[data-owner-auth-heading]");
  const authCopy = document.querySelector("[data-owner-auth-copy]");
  const authForm = document.querySelector("[data-owner-auth-form]");
  const authPassword = document.querySelector("[data-owner-auth-password]");
  const authSubmit = document.querySelector("[data-owner-auth-submit]");
  const authLogout = document.querySelector("[data-owner-auth-logout]");
  const countsRoot = document.querySelector("[data-owner-counts]");
  const unknownCountRoot = document.querySelector("[data-owner-unknown-count]");
  const hiddenCountRoot = document.querySelector("[data-owner-hidden-count]");
  const syncCountryKeywordsButton = document.querySelector("[data-owner-sync-country-keywords]");
  const publishHiddenBlacklistButton = document.querySelector("[data-owner-publish-hidden-blacklist]");
  const wipeHiddenR2Button = document.querySelector("[data-owner-wipe-hidden-r2]");
  const physicalProductsToggle = document.querySelector("[data-owner-physical-products]");
  const r2CoverageCard = document.querySelector("[data-owner-r2-coverage-card]");
  const r2CoverageSummary = document.querySelector("[data-owner-r2-coverage-summary]");
  const r2CoverageCounts = document.querySelector("[data-owner-r2-coverage-counts]");
  const r2CoverageNote = document.querySelector("[data-owner-r2-coverage-note]");
  const r2FixButton = document.querySelector("[data-owner-r2-fix]");
  const r2Card = document.querySelector("[data-owner-r2-card]");
  const r2Summary = document.querySelector("[data-owner-r2-summary]");
  const r2Counts = document.querySelector("[data-owner-r2-counts]");
  const productSettings = window.photosByElieProductSettings;
  let r2PollTimer = null;

  const setStatus = (message) => {
    if (status) status.textContent = message;
  };

  const renderAuthState = (authState = ownerAuth?.state || {}, options = {}) => {
    if (!authPanel || !ownerAuth?.enabled) return;
    const authenticated = authState.authenticated === true;
    const available = authState.available !== false;
    authPanel.hidden = false;
    authPanel.classList.toggle("is-owner-authenticated", authenticated);
    if (controls) controls.hidden = !authenticated;
    if (authHeading) authHeading.textContent = authenticated ? "Signed in" : "Sign in";
    if (authCopy) {
      authCopy.textContent = authenticated
        ? "Owner controls are unlocked for this local browser session."
        : available
          ? "Use the password from PHOTOSBYELIE_OWNER_PASSWORD, PBE_OWNER_PASSWORD, or the one-time code printed by the local server."
          : "Start the Photos By Elie local server to unlock owner controls.";
    }
    const passwordLabel = authPassword?.closest("label");
    if (passwordLabel) passwordLabel.hidden = authenticated;
    if (authPassword) {
      authPassword.disabled = authenticated || !available;
      if (authenticated) authPassword.value = "";
    }
    if (authSubmit) {
      authSubmit.hidden = authenticated;
      authSubmit.disabled = !available;
    }
    if (authLogout) authLogout.hidden = !authenticated;
    if (authenticated) {
      setStatus("Owner controls unlocked.");
      renderCounts();
      loadR2Coverage();
      startR2Polling();
      if (options.scrollToControls && controls) {
        window.requestAnimationFrame(() => {
          controls.scrollIntoView({ block: "start", behavior: "smooth" });
        });
      }
    } else if (available) {
      setStatus("Owner login required before catalog or cloud actions can run.");
    } else {
      setStatus("Owner controls need the local helper server.");
    }
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
    const isRepair = latest.operation === "repair";
    const activeVerb = isRepair ? "Repairing" : isDelete ? "Deleting" : "Uploading";
    const noun = isRepair ? "repair" : isDelete ? "delete" : "upload";
    if (active) {
      r2Summary.textContent = `${activeVerb} R2 updates: ${completed}/${total} files, ${failed} failed.`;
    } else if (failed) {
      r2Summary.textContent = `R2 ${noun} needs attention: ${failed}/${total} files failed.`;
    } else {
      r2Summary.textContent = `Last R2 ${noun} finished: ${completed} files.`;
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

  const formatCount = (value) => Number(value || 0).toLocaleString();

  const renderR2Coverage = (coverage = null) => {
    if (!r2CoverageCard || !r2CoverageSummary || !r2CoverageCounts || !r2CoverageNote) return;
    if (!coverage) {
      r2CoverageSummary.textContent = "R2 coverage is unavailable.";
      r2CoverageCounts.innerHTML = "";
      r2CoverageNote.textContent = "";
      if (r2FixButton) r2FixButton.disabled = true;
      return;
    }
    r2CoverageSummary.textContent = coverage.ok
      ? `Current catalog policy is satisfied for ${formatCount(coverage.catalogPhotos)} photos.`
      : `Coverage needs repair for ${formatCount(coverage.catalogPhotos)} catalog photos.`;
    r2CoverageCounts.innerHTML = (coverage.rows || []).map((row) => `
      <div class="${row.ok ? "is-ok" : "needs-work"}">
        <dt>${escapeHtml(row.label)}</dt>
        <dd>${formatCount(row.present)} / ${formatCount(row.expected)}</dd>
        <small>${row.missing ? `${formatCount(row.missing)} missing` : "complete"}${row.extra ? `, ${formatCount(row.extra)} extra` : ""}</small>
      </div>
    `).join("");
    r2CoverageNote.textContent = [coverage.recommendation, coverage.note].filter(Boolean).join(" ");
    if (r2FixButton) {
      r2FixButton.disabled = coverage.ok;
      r2FixButton.dataset.coverageOk = coverage.ok ? "true" : "false";
    }
  };

  const loadR2Coverage = async () => {
    if (!r2CoverageCard || !hiddenActions?.enabled) return;
    try {
      const response = await fetch("/__photosbyelie/r2-coverage", { cache: "no-store" });
      if (!response.ok) throw new Error(`R2 coverage ${response.status}`);
      const payload = await response.json();
      renderR2Coverage(payload.coverage);
    } catch {
      renderR2Coverage(null);
    }
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
    if (authPanel) authPanel.hidden = true;
    if (locked) locked.hidden = false;
    setStatus("Owner controls are locked on the public site.");
    return;
  }

  if (controls) controls.hidden = true;

  authForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = String(authPassword?.value || "");
    if (!password) {
      authPassword?.focus();
      return;
    }
    if (authSubmit) authSubmit.disabled = true;
    setStatus("Checking owner password...");
    try {
      const nextState = await ownerAuth.login(password);
      renderAuthState(nextState, { scrollToControls: true });
    } catch (error) {
      setStatus(error?.message || "Owner login failed.");
      authPassword?.focus();
    } finally {
      if (authSubmit) authSubmit.disabled = false;
    }
  });

  authLogout?.addEventListener("click", async () => {
    await ownerAuth?.logout?.();
    renderAuthState(ownerAuth?.state);
  });

  window.addEventListener("photosbyelie:ownerauthchange", (event) => {
    renderAuthState(event.detail || ownerAuth?.state);
  });

  ownerAuth?.refresh?.().then(renderAuthState);

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
    setStatus("Syncing country metadata into the catalog, local image files, and cloud queue...");
    try {
      const result = await hiddenActions.syncCountryKeywords?.();
      const updates = result?.keyword_updates || {};
      const fileCount = updates.asset_updated || 0;
      const metadataCount = updates.metadata_changed || 0;
      const errorCount = updates.error_count || 0;
      renderCounts();
      loadR2Progress();
      setStatus(`Country metadata synced: ${metadataCount} catalog rows changed, ${fileCount} local files updated${errorCount ? `, ${errorCount} file errors` : ""}.`);
    } catch (error) {
      setStatus(error?.message || "Could not sync country metadata.");
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

  r2FixButton?.addEventListener("click", async () => {
    const authorized = await ownerAuth?.requireAuth?.("Owner login required to repair R2 coverage.");
    if (ownerAuth?.enabled && !authorized) return;
    const ok = window.confirm("Run the full lock-guarded cloud media sweep now? This may upload/render missing objects, delete discarded R2 media, validate, commit, and push manifest changes.");
    if (!ok) return;
    r2FixButton.disabled = true;
    setStatus("Starting cloud media sweep repair...");
    try {
      const response = await fetch("/__photosbyelie/r2-fix", { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Could not start R2 repair.");
      setStatus("Cloud media sweep repair started.");
      renderR2Progress([payload.task]);
      loadR2Progress();
    } catch (error) {
      setStatus(error?.message || "Could not start R2 repair.");
      loadR2Coverage();
    }
  });

  window.addEventListener("photosbyelie:hiddenchange", renderCounts);

  reserveStore?.load?.().then(() => {
    if (ownerAuth?.state?.authenticated) renderCounts();
  });
  if (ownerAuth?.state?.authenticated) {
    renderCounts();
    loadR2Coverage();
    startR2Polling();
  }
})();
