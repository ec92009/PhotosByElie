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
  const r2Phases = document.querySelector("[data-owner-r2-phases]");
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

  const SWEEP_PHASES = [
    ["prepare", "Prepare workspace"],
    ["discard-start", "Delete discarded media"],
    ["camera", "Import Camera sources"],
    ["leonardo", "Import Leonardo sources"],
    ["catalog", "Export catalog"],
    ["worker", "Write worker catalog"],
    ["sidecar", "Write media sidecar"],
    ["private", "Backfill private JPGs"],
    ["discard-final", "Final discard cleanup"],
    ["test", "Run tests"],
    ["validate", "Validate publish"],
    ["commit", "Commit and push"],
  ].map(([key, label]) => ({ key, label }));

  const renderAuthState = (authState = ownerAuth?.state || {}, options = {}) => {
    if (!authPanel || !ownerAuth?.enabled) return;
    const authenticated = authState.authenticated === true;
    const available = authState.available !== false;
    authPanel.hidden = authenticated;
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

  const collectionLabelForPhoto = (photoId) => {
    const id = String(photoId || "");
    if (!id) return "";
    for (const [key, collection] of Object.entries(collections || {})) {
      if ((collection.photos || []).some((photo) => photo.id === id)) {
        return collection.title || key;
      }
    }
    return "";
  };

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
    if (r2CoverageNote && r2RepairActive) {
      setText(r2CoverageNote, "Repair is running. You do not need to remain on this page while the repair takes place.");
    }
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
    const started = lastMatch(/^START\s+([0-9,]+):\s+(\S+)\s+(\S+)\s+(.+)/);
    const imported = lastMatch(/^([0-9,]+):\s+(\S+)\s+rendered\s+(\S+)\s+public\s+([0-9,]+)\s+private-renders\s+([0-9,]+)/);
    const upload = lastMatch(/^([0-9,]+):\s+(\S+)\s+(?:uploaded|would upload)\s+([0-9,]+)/);
    const processed = lastMatch(/^Done\. Processed ([0-9,]+) photos?\./);
    const manifest = lastMatch(/^Refreshed .*?: ([0-9,]+) complete private render triplets\./);
    const error = lastMatch(/^(ERROR\b|.*\berror: ).*/i);
    const phaseMarker = lastMatch(/^SWEEP_PHASE\s+(\S+)\s+(.+)/);
    const doneKeys = new Set(lines
      .map((line) => line.match(/^SWEEP_DONE\s+(\S+)/)?.[1])
      .filter(Boolean));
    let phase = "Starting cloud media sweep";
    if (deleted) phase = "Deleted discarded R2 media";
    if (scan) phase = "Scanning and importing Saturn sources";
    if (started) phase = "Rendering and uploading selected photo";
    if (imported) phase = "Rendering and uploading selected previews";
    if (upload) phase = "Creating and uploading missing private JPGs";
    if (processed) phase = "Private JPG backfill pass finished";
    if (manifest) phase = "Refreshing private delivery manifest";
    if (phaseMarker) phase = phaseMarker.match[2];
    if (error) phase = "Needs attention";
    let phaseKey = phaseMarker?.match?.[1] || "";
    if (!phaseKey) {
      if (upload || processed || manifest) phaseKey = "private";
      else if (scan || started || imported) phaseKey = "camera";
      else if (deleted) phaseKey = "discard-start";
      else phaseKey = "prepare";
    }
    return { latest, phase, phaseKey, doneKeys, deleted, scan, started, imported, upload, processed, manifest, error };
  };

  const privateBackfillProgress = (logSummary) => {
    const privateRows = (window.photosByElieR2Coverage?.rows || [])
      .filter((row) => String(row.label || "").startsWith("Private JPG"));
    const uploaded = Number(logSummary?.upload?.match?.[1] || 0);
    const total = Math.max(
      0,
      Number(window.photosByElieR2Coverage?.catalogPhotos || 0),
      countPhotos(collections),
      ...privateRows.map((row) => Number(row.expected || 0)),
    );
    const complete = privateRows.length ? Math.min(...privateRows.map((row) => Number(row.present || 0))) : uploaded;
    const current = Number.isFinite(complete) && complete >= 0 ? complete : uploaded;
    const percent = total ? Math.min(99, Math.round((current / total) * 100)) : (uploaded ? 1 : 0);
    const detail = total
      ? `${current.toLocaleString()} of ${total.toLocaleString()}`
      : `${uploaded.toLocaleString()} photos`;
    return { percent: Math.max(current || uploaded ? 1 : 0, percent), detail };
  };

  const phaseProgress = (phase, logSummary, failed) => {
    if (failed) return { percent: 100, detail: "Needs attention" };
    if (phase.key === "discard-start" && logSummary?.deleted) {
      return { percent: 100, detail: `${logSummary.deleted.match[1]} public, ${logSummary.deleted.match[2]} private` };
    }
    if (phase.key === "camera" && (logSummary?.scan || logSummary?.started || logSummary?.imported)) {
      const selected = Number(logSummary?.scan?.match?.[3] || 0);
      const current = Number(logSummary?.imported?.match?.[1] || logSummary?.started?.match?.[1] || 0);
      const percent = selected ? Math.max(4, Math.min(96, Math.round((current / selected) * 100))) : 25;
      const photo = logSummary?.started?.match?.[2] || logSummary?.imported?.match?.[2] || "";
      return { percent, detail: selected ? `${current || 1} of ${selected}${photo ? `, ${photo}` : ""}` : "Scanning selected photos" };
    }
    if (phase.key === "private" && logSummary?.upload) {
      return privateBackfillProgress(logSummary);
    }
    return { percent: 18, detail: "Running" };
  };

  const completedPhaseDetail = (phase, logSummary) => {
    if (phase.key === "discard-start" && logSummary?.deleted) {
      return `${logSummary.deleted.match[1]} public, ${logSummary.deleted.match[2]} private`;
    }
    return "Done";
  };

  const renderSweepPhases = (task, logSummary = null) => {
    if (!r2Phases) return;
    if (!task || task.operation !== "repair") {
      setHtml(r2Phases, "");
      return;
    }
    const active = task.state === "queued" || task.state === "running";
    const failed = Number(task.failed || 0) > 0 || task.state === "failed";
    const complete = !active && !failed && task.state === "done";
    const activeKey = logSummary?.phaseKey || "prepare";
    const activeIndex = Math.max(0, SWEEP_PHASES.findIndex((phase) => phase.key === activeKey));
    const doneKeys = logSummary?.doneKeys || new Set();
    setHtml(r2Phases, SWEEP_PHASES.map((phase, index) => {
      const explicitDone = doneKeys.has(phase.key);
      const inferredDone = active && index < activeIndex;
      const isActive = phase.key === activeKey && active;
      const isFailed = phase.key === activeKey && failed;
      const state = isFailed ? "failed" : (complete || explicitDone || inferredDone) ? "done" : isActive ? "running" : "pending";
      const progress = state === "done"
        ? { percent: 100, detail: completedPhaseDetail(phase, logSummary) }
        : state === "running"
          ? phaseProgress(phase, logSummary, false)
          : state === "failed"
            ? phaseProgress(phase, logSummary, true)
            : { percent: 0, detail: "Waiting" };
      return `
        <div class="owner-sweep-phase is-${state}">
          <div class="owner-sweep-phase-copy">
            <strong>${escapeHtml(phase.label)}</strong>
            <span>${escapeHtml(progress.detail)}</span>
          </div>
          <div class="owner-sweep-bar" aria-label="${escapeHtml(phase.label)} progress">
            <span style="width:${progress.percent}%"></span>
          </div>
        </div>
      `;
    }).join(""));
  };

  const renderR2RepairProgress = (latest, logSummary = null) => {
    const active = latest.state === "queued" || latest.state === "running";
    const failed = Number(latest.failed || 0);
    renderSweepPhases(latest, logSummary);
    if (active) {
      setText(r2Summary, logSummary?.phase
        ? `${logSummary.phase}.`
        : "Running the lock-guarded cloud media sweep.");
    } else if (failed) {
      setText(r2Summary, logSummary?.phase === "Needs attention"
        ? "R2 coverage repair needs attention."
        : "R2 coverage repair stopped before completion.");
    } else {
      setText(r2Summary, "Last R2 coverage repair finished.");
    }
    const rows = [];
    if (logSummary?.started && !logSummary?.upload) {
      rows.push(["Current photo", logSummary.started.match[2]]);
      rows.push(["Collection", logSummary.started.match[3]]);
    }
    if (logSummary?.imported && !logSummary?.upload) {
      rows.push(["Rendered photos", logSummary.imported.match[1]]);
      rows.push(["Last rendered", logSummary.imported.match[2]]);
      rows.push(["Collection", logSummary.imported.match[3]]);
      rows.push(["Private renders", logSummary.imported.match[5]]);
    }
    if (logSummary?.upload) {
      const lastPhotoId = logSummary.upload.match[2];
      rows.push(["Last photo", lastPhotoId]);
      rows.push(["Collection", collectionLabelForPhoto(lastPhotoId) || "unknown"]);
    }
    if (logSummary?.manifest) rows.push(["Render triplets", logSummary.manifest.match[1]]);
    if (logSummary?.processed) rows.push(["Processed", logSummary.processed.match[1]]);
    if (logSummary?.error && (!active || logSummary.error.line === logSummary.latest)) rows.push(["Latest error", logSummary.error.line]);
    else if (logSummary?.latest && !active) rows.push(["Latest log", logSummary.latest]);
    if (!active) rows.push(["Result", failed ? `${failed} failed` : "complete"]);
    if (!rows.length) rows.push(["State", latest.state || "queued"]);
    const wideLabels = new Set(["Current photo", "Last photo", "Last rendered", "Latest error", "Latest log"]);
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
      renderSweepPhases(null);
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
    r2CoverageCounts.innerHTML = (coverage.rows || []).map((row) => {
      const isPrivateJpg = row.label.startsWith("Private JPG");
      const isPrivateMasters = row.label === "Private masters";
      const isAcceptedHiddenExtra = isPrivateMasters && Number(row.missing || 0) === 0 && Number(row.extra || 0) > 0;
      const detail = [
        row.missing ? `${formatCount(row.missing)} missing` : "complete",
        row.extra ? `${formatCount(row.extra)} ${isPrivateMasters ? "hidden" : "extra"}` : "",
      ].filter(Boolean).join(", ");
      return `
        <div class="${row.ok || isAcceptedHiddenExtra ? "is-ok" : "needs-work"}">
          <dt>${escapeHtml(row.label)}</dt>
          <dd>${formatCount(row.present)} / ${formatCount(row.expected)}</dd>
          <small>${escapeHtml(detail)}</small>
        </div>
      `;
    }).join("");
    r2CoverageNote.textContent = coverage.ok
      ? "Policy is satisfied for the current catalog."
      : "Missing coverage. Fix it runs the sweep below and keeps manifests in sync.";
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
