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
  let r2RepairLogToken = "";
  let r2RepairActive = false;
  let r2CoverageOk = false;
  let r2RepairLogSummary = null;
  let r2RepairLogTaskId = "";

  const setStatus = (message) => {
    if (status) status.textContent = message;
  };

  const setText = (element, value) => {
    if (element && element.textContent !== value) element.textContent = value;
  };

  const setHtml = (element, value) => {
    if (element && element.innerHTML !== value) element.innerHTML = value;
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

  const logUrlForTask = (task) => {
    const logName = task?.log ? String(task.log).split("/").pop() : "";
    return logName ? `/.review-logs/${encodeURIComponent(logName)}` : "";
  };

  const syncR2FixButton = () => {
    if (!r2FixButton) return;
    r2FixButton.disabled = r2CoverageOk || r2RepairActive;
    r2FixButton.textContent = r2RepairActive ? "Repair running" : "Fix it";
  };

  const summarizeR2RepairLog = (text = "") => {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const latest = lines.at(-1) || "";
    const lastMatch = (pattern) => {
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const match = lines[index].match(pattern);
        if (match) return { line: lines[index], match };
      }
      return null;
    };
    const deleted = lastMatch(/^Done\. Deleted ([0-9,]+) public and ([0-9,]+) private object references for ([0-9,]+) discarded photos\./);
    const scan = lastMatch(/^(?:Processing (?:final )?batch after scanning|Scanned) ([0-9,]+) files[;,] inspected ([0-9,]+), selected ([0-9,]+)/);
    const imported = lastMatch(/^([0-9,]+):\s+(\S+)\s+rendered\s+(\S+)\s+public\s+([0-9,]+)\s+private-renders\s+([0-9,]+)/);
    const upload = lastMatch(/^([0-9,]+):\s+(\S+)\s+(?:uploaded|would upload)\s+([0-9,]+)/);
    const processed = lastMatch(/^Done\. Processed ([0-9,]+) photos?\./);
    const manifest = lastMatch(/^Refreshed .*?: ([0-9,]+) complete private render triplets\./);
    const error = lastMatch(/^(ERROR\b|.*\berror: ).*/i);
    let phase = "Starting cloud media sweep";
    if (deleted) phase = "Deleted discarded R2 media";
    if (scan) phase = "Scanning and importing Saturn sources";
    if (imported) phase = "Rendering and uploading selected previews";
    if (upload) phase = "Creating and uploading missing private JPGs";
    if (processed) phase = "Private JPG backfill pass finished";
    if (manifest) phase = "Refreshing private delivery manifest";
    if (error) phase = "Needs attention";
    return { latest, phase, deleted, scan, imported, upload, processed, manifest, error };
  };

  const renderR2RepairProgress = (latest, logSummary = null) => {
    const active = latest.state === "queued" || latest.state === "running";
    const failed = Number(latest.failed || 0);
    const logName = latest.log ? String(latest.log).split("/").pop() : "";
    if (active) {
      setText(r2Summary, logSummary?.phase
        ? `${logSummary.phase}.`
        : "Repairing R2 coverage with the lock-guarded cloud media sweep. This can run for a long time; reading the log for current counters.");
    } else if (failed) {
      setText(r2Summary, logSummary?.phase === "Needs attention"
        ? "R2 coverage repair needs attention. The latest log line is shown below."
        : "R2 coverage repair needs attention. Open the log below for the failing phase.");
    } else {
      setText(r2Summary, "Last R2 coverage repair finished.");
    }
    const rows = [
      ["State", latest.state || "unknown"],
      ["Phase", logSummary?.phase || "Cloud media sweep"],
      ["Started", latest.started_at ? new Date(latest.started_at).toLocaleString() : "queued"],
      ["Log", logName || "owner-r2-fix log"],
    ];
    if (logSummary?.scan) {
      rows.push(["Scanned", logSummary.scan.match[1]]);
      rows.push(["Selected", logSummary.scan.match[3]]);
    }
    if (logSummary?.imported) {
      rows.push(["Rendered photos", logSummary.imported.match[1]]);
      rows.push(["Last rendered", logSummary.imported.match[2]]);
      rows.push(["Collection", logSummary.imported.match[3]]);
      rows.push(["Private renders", logSummary.imported.match[5]]);
    }
    if (logSummary?.upload) {
      rows.push(["Backfilled photos", logSummary.upload.match[1]]);
      rows.push(["Last photo", logSummary.upload.match[2]]);
      rows.push(["Objects last", logSummary.upload.match[3]]);
    }
    if (logSummary?.manifest) rows.push(["Render triplets", logSummary.manifest.match[1]]);
    if (logSummary?.processed) rows.push(["Processed", logSummary.processed.match[1]]);
    if (logSummary?.deleted) rows.push(["Discarded deleted", `${logSummary.deleted.match[1]} public, ${logSummary.deleted.match[2]} private`]);
    if (logSummary?.error) rows.push(["Latest error", logSummary.error.line]);
    else if (logSummary?.latest) rows.push(["Latest log", logSummary.latest]);
    if (!active) rows.push(["Result", failed ? `${failed} failed` : "complete"]);
    const wideLabels = new Set(["Log", "Last photo", "Last rendered", "Latest error", "Latest log"]);
    setHtml(r2Counts, rows.map(([label, value]) => `
      <div class="${wideLabels.has(label) ? "is-wide" : ""}">
        <dt>${escapeHtml(label)}</dt>
        <dd>${escapeHtml(value)}</dd>
      </div>
    `).join(""));
  };

  const loadR2RepairLog = async (task) => {
    if (!task?.id || task.operation !== "repair") return;
    const logUrl = logUrlForTask(task);
    if (!logUrl) return;
    const token = `${task.id}:${task.updated_at || ""}:${task.state || ""}`;
    r2RepairLogToken = token;
    try {
      const response = await fetch(logUrl, { cache: "no-store" });
      if (!response.ok) throw new Error(`Log ${response.status}`);
      const text = await response.text();
      if (r2RepairLogToken !== token) return;
      r2RepairLogTaskId = task.id;
      r2RepairLogSummary = summarizeR2RepairLog(text);
      renderR2RepairProgress(task, r2RepairLogSummary);
      renderR2Coverage(window.photosByElieR2Coverage || null);
    } catch {
      renderR2RepairProgress(task);
    }
  };

  const renderR2Progress = (tasks = []) => {
    if (!r2Card || !r2Summary || !r2Counts) return;
    const latest = tasks[0];
    if (!latest) {
      if (!r2Card.hidden) r2Card.hidden = true;
      setHtml(r2Counts, "");
      r2RepairActive = false;
      r2RepairLogTaskId = "";
      r2RepairLogSummary = null;
      syncR2FixButton();
      return;
    }
    if (r2Card.hidden) r2Card.hidden = false;
    const total = Number(latest.total || 0);
    const completed = Number(latest.completed || 0);
    const failed = Number(latest.failed || 0);
    const active = latest.state === "queued" || latest.state === "running";
    const isDelete = latest.operation === "delete";
    const isRepair = latest.operation === "repair";
    r2RepairActive = isRepair && active;
    syncR2FixButton();
    const activeVerb = isRepair ? "Repairing" : isDelete ? "Deleting" : "Uploading";
    const noun = isRepair ? "repair" : isDelete ? "delete" : "upload";
    if (isRepair) {
      renderR2RepairProgress(latest, latest.id === r2RepairLogTaskId ? r2RepairLogSummary : null);
      return;
    }
    if (active) {
      setText(r2Summary, `${activeVerb} R2 updates: ${completed}/${total} files, ${failed} failed.`);
    } else if (failed) {
      setText(r2Summary, `R2 ${noun} needs attention: ${failed}/${total} files failed.`);
    } else {
      setText(r2Summary, `Last R2 ${noun} finished: ${completed} files.`);
    }
    const rows = [
      ["State", latest.state || "unknown"],
      ["Work", latest.kind || "background"],
      ["Photo", latest.photo_id || "metadata"],
      ["Files", `${completed}/${total}`],
      ["Failed", failed],
      ["Uploaded", `${formatBytes(latest.bytes_done)} / ${formatBytes(latest.bytes_total)}`],
    ];
    setHtml(r2Counts, rows.map(([label, value]) => `
      <div>
        <dt>${escapeHtml(label)}</dt>
        <dd>${escapeHtml(value)}</dd>
      </div>
    `).join(""));
  };

  const formatCount = (value) => Number(value || 0).toLocaleString();

  const renderR2Coverage = (coverage = null) => {
    if (!r2CoverageCard || !r2CoverageSummary || !r2CoverageCounts || !r2CoverageNote) return;
    if (!coverage) {
      r2CoverageOk = false;
      r2CoverageSummary.textContent = "R2 coverage is unavailable.";
      r2CoverageCounts.innerHTML = "";
      r2CoverageNote.textContent = "";
      if (r2FixButton) r2FixButton.disabled = true;
      return;
    }
    r2CoverageSummary.textContent = coverage.ok
      ? `Current catalog policy is satisfied for ${formatCount(coverage.catalogPhotos)} photos.`
      : `Coverage needs repair for ${formatCount(coverage.catalogPhotos)} catalog photos.`;
    window.photosByElieR2Coverage = coverage;
    const observedRenderPhotos = Number(r2RepairLogSummary?.upload?.match?.[1] || 0);
    r2CoverageCounts.innerHTML = (coverage.rows || []).map((row) => {
      const isPrivateJpg = row.label.startsWith("Private JPG");
      const observed = isPrivateJpg ? observedRenderPhotos : 0;
      const present = Math.min(row.expected, row.present + observed);
      const missing = Math.max(0, row.missing - observed);
      const detail = [
        missing ? `${formatCount(missing)} missing` : "complete",
        row.extra ? `${formatCount(row.extra)} extra` : "",
        observed ? `${formatCount(observed)} observed this run` : "",
      ].filter(Boolean).join(", ");
      return `
        <div class="${row.ok ? "is-ok" : "needs-work"}">
          <dt>${escapeHtml(row.label)}</dt>
          <dd>${formatCount(present)} / ${formatCount(row.expected)}</dd>
          <small>${escapeHtml(detail)}</small>
        </div>
      `;
    }).join("");
    r2CoverageNote.textContent = [coverage.recommendation, coverage.note].filter(Boolean).join(" ");
    r2CoverageOk = coverage.ok;
    if (r2FixButton) {
      r2FixButton.dataset.coverageOk = coverage.ok ? "true" : "false";
      syncR2FixButton();
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
      if (tasks[0]?.operation === "repair") loadR2RepairLog(tasks[0]);
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
      r2RepairActive = true;
      syncR2FixButton();
      setStatus("Cloud media sweep repair started.");
      renderR2Progress([payload.task]);
      loadR2Progress();
    } catch (error) {
      r2RepairActive = false;
      syncR2FixButton();
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
