(() => {
  const ownerAuth = window.photosByElieOwnerAuth;
  const hiddenActions = window.photosByElieHiddenActions;
  const reserveStore = window.photosByElieReserve;
  const collections = window.photosByElieData || {};
  const controls = document.querySelector("[data-owner-controls]");
  const locked = document.querySelector("[data-owner-locked]");
  const status = document.querySelector("[data-owner-status]");
  const unknownCountRoot = document.querySelector("[data-owner-unknown-count]");
  const hiddenCountRoot = document.querySelector("[data-owner-hidden-count]");
  const discardedCountRoot = document.querySelector("[data-owner-discarded-count]");
  const originCameraCountRoot = document.querySelector("[data-owner-origin-camera-count]");
  const originAiCountRoot = document.querySelector("[data-owner-origin-ai-count]");
  const originAiShareRoot = document.querySelector("[data-owner-origin-ai-share]");
  const overviewAnalyzedCountRoot = document.querySelector("[data-owner-overview-analyzed-count]");
  const overviewBasketCountRoot = document.querySelector("[data-owner-overview-basket-count]");
  const overviewExpoCountRoot = document.querySelector("[data-owner-overview-expo-count]");
  const catalogPieRoot = document.querySelector("[data-owner-catalog-pie]");
  const blockedLocalCountRoot = document.querySelector("[data-owner-blocked-local-count]");
  const blockedPreviewCountRoot = document.querySelector("[data-owner-blocked-preview-count]");
  const blockedPreviewNoteRoot = document.querySelector("[data-owner-blocked-preview-note]");
  const syncCountryKeywordsButton = document.querySelector("[data-owner-sync-country-keywords]");
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
  const priceListRoot = document.querySelector("[data-owner-price-list]");
  const keywordBlacklistForm = document.querySelector("[data-owner-keyword-blacklist-form]");
  const keywordBlacklistInput = document.querySelector("[data-owner-keyword-blacklist-input]");
  const keywordBlacklistStatus = document.querySelector("[data-owner-keyword-blacklist-status]");
  const refreshButtons = [...document.querySelectorAll("[data-owner-refresh]")];
  const productSettings = window.photosByElieProductSettings;
  let r2PollTimer = null;
  let r2RepairLogToken = "";
  let r2RepairActive = false;
  let r2CoverageOk = false;
  let r2RepairLogSummary = null;
  let r2RepairLogTaskId = "";
  let keywordBlacklistTerms = [];

  const setStatus = (message) => {
    if (status) status.textContent = message;
  };

  const setText = (element, value) => {
    if (element && element.textContent !== value) element.textContent = value;
  };

  const setHtml = (element, value) => {
    if (element && element.innerHTML !== value) element.innerHTML = value;
  };

  const setRefreshBusy = (kind, busy) => {
    refreshButtons
      .filter((button) => button.dataset.ownerRefresh === kind)
      .forEach((button) => {
        button.disabled = busy;
        button.classList.toggle("is-refreshing", busy);
      });
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
    ["storage", "Refresh storage estimate"],
    ["test", "Run tests"],
    ["validate", "Validate publish"],
    ["commit", "Commit and push"],
    ["coverage", "Recheck coverage"],
  ].map(([key, label]) => ({ key, label }));

  const renderOwnerAvailability = (authState = ownerAuth?.state || {}, options = {}) => {
    if (!ownerAuth?.enabled) return;
    const available = authState.available === true;
    if (controls) controls.hidden = !available;
    if (locked) locked.hidden = available;
    if (available) {
      setStatus("Owner controls unlocked on localhost.");
      refreshCountsFromSource();
      refreshBlockedSyncPanel();
      loadR2Coverage();
      loadKeywordBlacklist();
      startR2Polling();
      if (options.scrollToControls && controls) {
        window.requestAnimationFrame(() => {
          controls.scrollIntoView({ block: "start", behavior: "smooth" });
        });
      }
    } else {
      setText(locked, "Owner controls need the local helper server.");
      setStatus("Owner controls need the local helper server.");
    }
  };

  const countPhotos = (data) => Object.values(data || {})
    .reduce((sum, collection) => sum + (collection.photos?.length || 0), 0);

  const collectionPhotoIdSet = (data) => {
    const ids = new Set();
    Object.values(data || {}).forEach((collection) => {
      (collection.photos || []).forEach((photo) => {
        if (photo?.id) ids.add(photo.id);
      });
    });
    return ids;
  };

  const originCountsForCollections = (data, excludedIds = new Set()) => (
    Object.entries(data || {}).reduce((counts, [collectionKey, collection]) => {
      (collection.photos || []).forEach((photo) => {
        if (!photo?.id || excludedIds.has(photo.id)) return;
        const origin = window.photosByEliePhotoOrigin?.(photo, collectionKey)
          || (collectionKey === "ai" ? "ai" : "camera");
        counts[origin === "ai" ? "ai" : "camera"] += 1;
      });
      return counts;
    }, { camera: 0, ai: 0 })
  );

  const renderOriginSplit = (hiddenIds = []) => {
    const counts = originCountsForCollections(collections, new Set(hiddenIds));
    const total = counts.camera + counts.ai;
    if (originCameraCountRoot) originCameraCountRoot.textContent = formatCount(counts.camera);
    if (originAiCountRoot) originAiCountRoot.textContent = formatCount(counts.ai);
    if (originAiShareRoot) originAiShareRoot.textContent = total ? `${Math.round((counts.ai / total) * 100)}%` : "0%";
    return { ...counts, total };
  };

  const renderCatalogPie = ({ camera = 0, ai = 0, basket = 0, analyzed = 0 } = {}) => {
    if (!catalogPieRoot) return;
    const total = Math.max(0, camera + ai + basket);
    const cameraDeg = total ? (camera / total) * 360 : 0;
    const aiDeg = total ? ((camera + ai) / total) * 360 : cameraDeg;
    catalogPieRoot.style.setProperty("--owner-camera-end", `${cameraDeg}deg`);
    catalogPieRoot.style.setProperty("--owner-ai-end", `${aiDeg}deg`);
    catalogPieRoot.toggleAttribute("data-empty", !total);
    catalogPieRoot.setAttribute(
      "aria-label",
      `Catalog split: ${formatCount(camera)} camera, ${formatCount(ai)} AI, ${formatCount(basket)} in basket, ${formatCount(analyzed)} analyzed.`
    );
  };

  window.addEventListener("photosbyelie:ownerbusychange", (event) => {
    const detail = event.detail || {};
    if (detail.busy) setStatus(detail.message || "Owner action is running...");
  });

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

  const photoEntryForId = (photoId) => {
    const id = String(photoId || "");
    if (!id) return null;
    for (const [key, collection] of Object.entries(collections || {})) {
      const photo = (collection.photos || []).find((candidate) => candidate.id === id);
      if (photo) return { collectionKey: key, collection, photo };
    }
    return null;
  };

  const detailHrefForPhoto = (photoId) => {
    const href = `./photo.html?id=${encodeURIComponent(photoId)}`;
    return window.photosByElieVersionedHref?.(href) || href;
  };

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

  const formatBytes = (value) => {
    const bytes = Number(value || 0);
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }
    return `${size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
  };

  const formatMoney = (value) => {
    const amount = Number(value || 0);
    return Number.isFinite(amount) ? `$${amount.toFixed(amount % 1 ? 2 : 0)}` : "$0";
  };

  const productLabel = (option) => window.photosByElieProductLabel?.(option) || option?.label || option?.id || "";
  const productDetail = (option) => option?.detail || "";
  const renderPriceList = () => {
    if (!priceListRoot) return;
    productSettings?.applyPriceOverrides?.();
    const options = window.photosByElieResolutions || [];
    const frames = window.photosByElieFrameOptions || [];
    const digitalOptions = options.filter((option) => option.type !== "print");
    const printOptions = options.filter((option) => option.type === "print");
    const priceTiers = window.photosByEliePriceTiers || { original: { label: "Camera photo" } };
    const digitalTierIds = Object.keys(priceTiers);
    const frameColumns = frames.filter((frame) => frame.id !== "none");
    const frameGroupIds = frameColumns.map((frame) => frame.id).join(",");
    const framePrice = (frame, option) => window.photosByElieFramePrice?.(frame, option) || Number(frame?.price) || 0;
    const frameGroupPrice = (option) => frameColumns.length ? framePrice(frameColumns[0], option) : 0;
    const shippingPrice = (option) => window.photosByElieOptionShippingHandlingUnitPrice?.(option) || 0;
    const optionTierPrice = (option, tier) => Number(option?.prices?.[tier] ?? option?.price ?? 0);
    const priceInput = ({ kind, id, optionId = "", value, label }) => `
      <label class="owner-price-field">
        <span>${escapeHtml(label)}</span>
        <input type="number" min="0" step="1" inputmode="decimal" value="${escapeHtml(value)}"
          data-owner-price-kind="${kind}" data-owner-price-id="${escapeHtml(id)}" data-owner-price-option="${escapeHtml(optionId)}"/>
      </label>
    `;
    const digitalRows = digitalOptions.map((option) => `
      <tr>
        <th scope="row">${escapeHtml(productLabel(option))}</th>
        <td>${escapeHtml(productDetail(option))}</td>
        ${digitalTierIds.map((tier) => `
          <td>${priceInput({
            kind: "option-tier",
            id: option.id,
            optionId: tier,
            value: optionTierPrice(option, tier),
            label: `${priceTiers[tier]?.label || tier} ${productLabel(option)} price`,
          })}</td>
        `).join("")}
        <td colspan="2">Digital delivery</td>
      </tr>
    `).join("");
    const printRows = printOptions.map((option) => `
      <tr>
        <th scope="row">${escapeHtml(productLabel(option))}</th>
        <td>${escapeHtml(productDetail(option))}</td>
        <td>${priceInput({ kind: "option", id: option.id, value: option.price, label: `${productLabel(option)} base price` })}</td>
        <td>Same print price</td>
        <td>${priceInput({
          kind: "frame-group",
          id: frameGroupIds,
          optionId: option.id,
          value: frameGroupPrice(option),
          label: `Frame add-on for ${productLabel(option)}`,
        })}</td>
        <td>${priceInput({ kind: "shipping", id: option.id, value: shippingPrice(option), label: `${productLabel(option)} shipping and handling` })}</td>
      </tr>
    `).join("");
    priceListRoot.innerHTML = `
      <table class="owner-price-table">
        <thead>
          <tr>
            <th scope="col">Product</th>
            <th scope="col">Detail</th>
            ${digitalTierIds.map((tier) => `<th scope="col">${escapeHtml(priceTiers[tier]?.label || tier)}</th>`).join("")}
            <th scope="col">Frame</th>
            <th scope="col">S&amp;H</th>
          </tr>
        </thead>
        <tbody>
          ${digitalRows}
          ${printRows}
        </tbody>
      </table>
    `;
    priceListRoot.querySelectorAll("[data-owner-price-kind]").forEach((input) => {
      input.addEventListener("change", () => {
        const overrides = productSettings?.priceOverrides?.() || {};
        const value = Math.max(0, Number(input.value) || 0);
        input.value = String(value);
        if (input.dataset.ownerPriceKind === "option") {
          overrides.options = { ...(overrides.options || {}), [input.dataset.ownerPriceId]: value };
        } else if (input.dataset.ownerPriceKind === "option-tier") {
          const optionId = input.dataset.ownerPriceId;
          const tier = input.dataset.ownerPriceOption;
          overrides.optionPrices = { ...(overrides.optionPrices || {}) };
          overrides.optionPrices[optionId] = { ...(overrides.optionPrices[optionId] || {}), [tier]: value };
        } else if (input.dataset.ownerPriceKind === "frame-group") {
          const frameIds = String(input.dataset.ownerPriceId || "").split(",").filter(Boolean);
          const optionId = input.dataset.ownerPriceOption;
          overrides.frames = { ...(overrides.frames || {}) };
          frameIds.forEach((frameId) => {
            const frame = overrides.frames?.[frameId] || {};
            overrides.frames[frameId] = {
              ...frame,
              prices: { ...(frame.prices || {}), [optionId]: value },
            };
          });
        } else if (input.dataset.ownerPriceKind === "shipping") {
          overrides.shippingHandling = { ...(overrides.shippingHandling || {}), [input.dataset.ownerPriceId]: value };
        }
        productSettings?.savePriceOverrides?.(overrides);
        setStatus("Price list saved locally.");
      });
    });
  };

  const normalizeKeywordTerms = (values = []) => {
    const seen = new Set();
    return values
      .flatMap((value) => String(value || "").split(/[\n,]/))
      .map((value) => value.trim())
      .filter((value) => {
        const key = value.casefold?.() || value.toLowerCase();
        if (!value || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  };

  const setKeywordBlacklistStatus = (message) => {
    if (keywordBlacklistStatus) keywordBlacklistStatus.textContent = message;
  };

  const renderKeywordBlacklist = (terms = keywordBlacklistTerms) => {
    if (!keywordBlacklistInput) return;
    keywordBlacklistTerms = normalizeKeywordTerms(terms);
    keywordBlacklistInput.value = keywordBlacklistTerms.join(", ");
    setKeywordBlacklistStatus(`${formatCount(keywordBlacklistTerms.length)} terms.`);
  };

  const saveKeywordBlacklist = async (terms) => {
    const authorized = await ownerAuth?.requireAuth?.("Start the local Photos By Elie server to save the keyword blacklist.");
    if (ownerAuth?.enabled && !authorized) throw new Error("Owner helper server required.");
    setKeywordBlacklistStatus("Saving blacklist...");
    const response = await fetch("/__photosbyelie/photo-action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "save-keyword-blacklist",
        keywords: normalizeKeywordTerms(terms),
        mode: "replace",
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.ok) {
      if (response.status === 401) ownerAuth?.markSignedOut?.();
      throw new Error(payload?.error || "Could not save keyword blacklist.");
    }
    renderKeywordBlacklist(payload.keywords || []);
    setStatus(`Keyword blacklist saved: ${formatCount(payload.keyword_count || 0)} terms.`);
    return payload;
  };

  const loadKeywordBlacklist = async () => {
    if (!keywordBlacklistInput) return;
    setKeywordBlacklistStatus("Loading blacklist...");
    try {
      const href = window.photosByElieVersionedHref?.("./assets/owner-actions/keyword-blacklist.json") || "./assets/owner-actions/keyword-blacklist.json";
      const response = await fetch(href, { cache: "no-store" });
      if (!response.ok) throw new Error(`Keyword blacklist ${response.status}`);
      const payload = await response.json();
      renderKeywordBlacklist(payload.keywords || []);
    } catch (error) {
      renderKeywordBlacklist([]);
      setKeywordBlacklistStatus(error?.message || "Could not load blacklist.");
    }
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
    if (!hiddenActions?.enabled) return;
    const hiddenIds = hiddenActions.read();
    const hiddenCount = hiddenIds.length;
    const expoTotal = countPhotos(collections);
    const expoPhotoIds = collectionPhotoIdSet(collections);
    const blockedInExpo = hiddenIds.filter((photoId) => expoPhotoIds.has(photoId)).length;
    const expoActive = Math.max(0, expoTotal - blockedInExpo);
    const analyzedTotal = expoActive + hiddenCount;
    const queue = unknownQueueState();
    const originCounts = renderOriginSplit(hiddenIds);
    renderCatalogPie({
      camera: originCounts.camera,
      ai: originCounts.ai,
      basket: hiddenCount,
      analyzed: analyzedTotal,
    });
    if (unknownCountRoot) unknownCountRoot.textContent = String(queue.visible.length);
    if (hiddenCountRoot) hiddenCountRoot.textContent = String(hiddenCount);
    if (overviewAnalyzedCountRoot) overviewAnalyzedCountRoot.textContent = formatCount(analyzedTotal);
    if (overviewBasketCountRoot) overviewBasketCountRoot.textContent = formatCount(hiddenCount);
    if (overviewExpoCountRoot) overviewExpoCountRoot.textContent = formatCount(expoActive);
    if (blockedLocalCountRoot) blockedLocalCountRoot.textContent = formatCount(hiddenCount);
  };

  const blockedCloudMediaCountFromCoverage = () => (window.photosByElieR2Coverage?.rows || [])
    .reduce((total, row) => total + Number(row.blockedPresent || 0), 0);

  const refreshBlockedSyncPanel = async () => {
    if (blockedLocalCountRoot) blockedLocalCountRoot.textContent = formatCount((hiddenActions.read?.() || []).length);
    const blockedCloudMedia = blockedCloudMediaCountFromCoverage();
    if (blockedPreviewCountRoot) blockedPreviewCountRoot.textContent = formatCount(blockedCloudMedia);
    if (blockedPreviewNoteRoot) {
      blockedPreviewNoteRoot.textContent = blockedCloudMedia
        ? `${formatCount(blockedCloudMedia)} cloud media copies for basketed photos are still present. Empty the basket to purge them and keep tombstones.`
        : "Basketed photos no longer have cloud media copies in R2.";
    }
  };

  const refreshDiscardedCount = async () => {
    if (!discardedCountRoot) return;
    try {
      const json = async (path) => {
        const href = window.photosByElieVersionedHref?.(path) || path;
        const response = await fetch(href, { cache: "no-store" });
        if (!response.ok) return {};
        return response.json();
      };
      const [tombstone, cleanup] = await Promise.all([
        json("./assets/discarded/discarded-photo-ids.json"),
        json("./assets/discarded-media-manifest.json"),
      ]);
      const ids = new Set([
        ...(Array.isArray(tombstone.photo_ids) ? tombstone.photo_ids : []),
        ...(Array.isArray(tombstone.photos) ? tombstone.photos.map((photo) => photo?.id) : []),
        ...(Array.isArray(cleanup.discardedPhotoIds) ? cleanup.discardedPhotoIds : []),
      ].filter(Boolean));
      discardedCountRoot.textContent = String(ids.size);
    } catch {
      discardedCountRoot.textContent = "0";
    }
  };

  const refreshCountsFromSource = async () => {
    try {
      await hiddenActions.syncFromPublishedBlacklist?.();
    } catch {
      // Keep the local owner list usable if the static blocked list cannot be fetched.
    }
    renderCounts();
    refreshDiscardedCount();
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

  const coverageMissingCount = () => Math.max(
    0,
    ...(window.photosByElieR2Coverage?.rows || []).map((row) => Number(row.missing || 0)),
  );

  const coverageMissingDetail = () => {
    const missing = coverageMissingCount();
    return missing ? `${formatCount(missing)} missing` : "Still missing coverage";
  };

  const phaseProgress = (phase, logSummary, failed) => {
    if (failed) return { percent: 100, detail: phase.key === "coverage" ? coverageMissingDetail() : "Needs attention" };
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
    if (phase.key === "coverage") return "Satisfied";
    return "Done";
  };

  const renderSweepPhases = (task, logSummary = null) => {
    if (!r2Phases) return;
    if (!task || task.operation !== "repair") {
      setHtml(r2Phases, "");
      return;
    }
    const active = task.state === "queued" || task.state === "running";
    const coverageIncomplete = !active && task.state === "done" && r2CoverageOk === false;
    const failed = Number(task.failed || 0) > 0 || task.state === "failed" || coverageIncomplete;
    const complete = !active && !failed && task.state === "done";
    const activeKey = coverageIncomplete ? "coverage" : logSummary?.phaseKey || "prepare";
    const activeIndex = Math.max(0, SWEEP_PHASES.findIndex((phase) => phase.key === activeKey));
    const doneKeys = logSummary?.doneKeys || new Set();
    setHtml(r2Phases, SWEEP_PHASES.map((phase, index) => {
      const explicitDone = doneKeys.has(phase.key);
      const inferredDone = (active || coverageIncomplete) && index < activeIndex;
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
    const coverageIncomplete = !active && latest.state === "done" && r2CoverageOk === false;
    const failureCount = Number(latest.failed || 0);
    const failed = failureCount > 0 || latest.state === "failed" || coverageIncomplete;
    renderSweepPhases(latest, logSummary);
    if (active) {
      if (latest.external_pid) {
        setText(r2Summary, logSummary?.phase
          ? `${logSummary.phase}. Existing sweep pid ${latest.external_pid}.`
          : `Cloud media sweep is already running with pid ${latest.external_pid}.`);
      } else {
        setText(r2Summary, logSummary?.phase
          ? `${logSummary.phase}.`
          : "Running the lock-guarded cloud media sweep.");
      }
    } else if (failed) {
      setText(r2Summary, coverageIncomplete
        ? `R2 repair finished, but coverage is still missing (${coverageMissingDetail()}).`
        : logSummary?.phase === "Needs attention"
        ? "R2 coverage repair needs attention."
        : "R2 coverage repair stopped before completion.");
    } else {
      setText(r2Summary, "Last R2 coverage repair finished.");
    }
    const rows = [];
    let lastPhotoId = "";
    if (latest.external_pid) rows.push(["Sweep PID", latest.external_pid]);
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
      lastPhotoId = logSummary.upload.match[2];
      rows.push(["Last photo", lastPhotoId]);
      rows.push(["Collection", collectionLabelForPhoto(lastPhotoId) || "unknown"]);
    }
    if (logSummary?.manifest) rows.push(["Render triplets", logSummary.manifest.match[1]]);
    if (logSummary?.processed) rows.push(["Processed", logSummary.processed.match[1]]);
    if (coverageIncomplete) rows.push(["Coverage", coverageMissingDetail()]);
    if (Array.isArray(latest.errors) && latest.errors.length) rows.push(["Latest error", latest.errors.at(-1)]);
    if (logSummary?.error && (!active || logSummary.error.line === logSummary.latest)) rows.push(["Latest error", logSummary.error.line]);
    else if (logSummary?.latest && !active) rows.push(["Latest log", logSummary.latest]);
    if (!active) rows.push(["Result", coverageIncomplete ? "coverage still missing" : failed ? `${failureCount || 1} failed` : "complete"]);
    if (!rows.length) rows.push(["State", latest.state || "queued"]);
    const wideLabels = new Set(["Current photo", "Last photo", "Last rendered", "Latest error", "Latest log"]);
    setHtml(r2Counts, rows.map(([label, value]) => `
      <div class="${wideLabels.has(label) ? "is-wide" : ""}">
        <dt>${escapeHtml(label)}</dt>
        <dd>${escapeHtml(value)}</dd>
      </div>
    `).join(""));
    renderR2PhotoPreview(lastPhotoId);
  };

  const renderR2PhotoPreview = (photoId) => {
    if (!r2Card || !r2Counts) return;
    const existing = r2Card.querySelector("[data-owner-r2-preview]");
    const entry = photoEntryForId(photoId);
    if (!entry) {
      existing?.remove();
      return;
    }
    const { collection, photo } = entry;
    const src = window.photosByElieMediaUrl?.(photo, "gallery") || "";
    if (!src) {
      existing?.remove();
      return;
    }
    const title = photo.title || photo.id;
    const meta = [
      collection.title || collectionLabelForPhoto(photo.id) || "Collection",
      photo.megapixels ? `${photo.megapixels} MP` : "",
      photo.full || "",
    ].filter(Boolean).join(" · ");
    const html = `
      <a class="owner-r2-preview" data-owner-r2-preview href="${escapeHtml(detailHrefForPhoto(photo.id))}">
        <span class="owner-r2-preview-image">
          <img src="${escapeHtml(src)}" alt="${escapeHtml(title)}" loading="lazy"/>
        </span>
        <span class="owner-r2-preview-copy">
          <span>Last photo</span>
          <strong>${escapeHtml(title)}</strong>
          <small>${escapeHtml(meta)}</small>
        </span>
      </a>
    `;
    if (existing) existing.outerHTML = html;
    else r2Counts.insertAdjacentHTML("afterend", html);
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
      await loadR2Coverage();
      renderR2RepairProgress(task, r2RepairLogSummary);
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
    const activeCatalogPhotos = Number(coverage.activeCatalogPhotos || coverage.catalogPhotos || 0);
    const basketCatalogPhotos = Number(coverage.blockedCatalogPhotos || 0);
    r2CoverageSummary.textContent = coverage.ok
      ? basketCatalogPhotos
        ? `Coverage is satisfied for ${formatCount(activeCatalogPhotos)} active photos; ${formatCount(basketCatalogPhotos)} Waste Basket photos are excluded.`
        : `Coverage is satisfied for ${formatCount(activeCatalogPhotos)} active photos.`
      : `Coverage needs repair for ${formatCount(activeCatalogPhotos)} active catalog photos.`;
    window.photosByElieR2Coverage = coverage;
    r2CoverageCounts.innerHTML = (coverage.rows || []).map((row) => {
      const detail = [
        row.missing ? `${formatCount(row.missing)} active missing` : "active complete",
        row.blockedExcluded ? `${formatCount(row.blockedExcluded)} Waste Basket excluded` : "",
        row.blockedPresent ? `${formatCount(row.blockedPresent)} Waste Basket copies still present` : "",
        row.extra ? `${formatCount(row.extra)} extra` : "",
      ].filter(Boolean).join(", ");
      return `
        <div class="${row.ok ? "is-ok" : "needs-work"}">
          <dt>${escapeHtml(row.label)}</dt>
          <dd>${formatCount(row.present)} / ${formatCount(row.expected)}</dd>
          <small>${escapeHtml(detail)}</small>
        </div>
      `;
    }).join("");
    r2CoverageNote.textContent = coverage.ok
      ? basketCatalogPhotos
        ? "Active catalog coverage is satisfied; Waste Basket media is excluded from repair targets."
        : "Policy is satisfied for the current catalog."
      : "Missing coverage. Fix it runs the sweep below and keeps manifests in sync.";
    r2CoverageOk = coverage.ok;
    if (blockedPreviewCountRoot) blockedPreviewCountRoot.textContent = formatCount(blockedCloudMediaCountFromCoverage());
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
      if (tasks[0]?.operation === "repair") await loadR2RepairLog(tasks[0]);
      return tasks;
    } catch {
      renderR2Progress([]);
      return [];
    }
  };

  const refreshOwnerPanel = async (kind) => {
    setRefreshBusy(kind, true);
    try {
      if (kind === "counts") {
        await refreshCountsFromSource();
        setStatus("Catalog mix refreshed.");
      } else if (kind === "blocked-sync") {
        await loadR2Coverage();
        await refreshBlockedSyncPanel();
        setStatus("Waste Basket cleanup refreshed.");
      } else if (kind === "coverage") {
        await loadR2Coverage();
        setStatus("R2 catalog coverage refreshed.");
      } else if (kind === "progress") {
        await loadR2Progress();
        setStatus("R2 background work refreshed.");
      } else if (kind === "keyword-blacklist") {
        await loadKeywordBlacklist();
        setStatus("Keyword blacklist refreshed.");
      }
    } catch (error) {
      setStatus(error?.message || "Could not refresh this Owner panel.");
    } finally {
      setRefreshBusy(kind, false);
    }
  };

  const startR2Polling = () => {
    if (r2PollTimer || !hiddenActions?.enabled) return;
    loadR2Progress();
    r2PollTimer = window.setInterval(loadR2Progress, 3000);
  };

  if (!hiddenActions?.enabled) {
    if (controls) controls.hidden = true;
    setText(locked, "Owner controls are only available on localhost.");
    if (locked) locked.hidden = false;
    setStatus("Owner controls are locked on the public site.");
    return;
  }

  if (controls) controls.hidden = true;
  renderPriceList();

  window.addEventListener("photosbyelie:ownerauthchange", (event) => {
    renderOwnerAvailability(event.detail || ownerAuth?.state);
  });

  ownerAuth?.refresh?.().then((state) => renderOwnerAvailability(state, { scrollToControls: true }));

  if (physicalProductsToggle) {
    const physicalAvailable = productSettings?.physicalProductsAvailable?.() === true;
    physicalProductsToggle.checked = physicalAvailable && productSettings?.physicalProductsEnabled?.() === true;
    physicalProductsToggle.disabled = !physicalAvailable;
    physicalProductsToggle.closest("label")?.classList.toggle("is-disabled", !physicalAvailable);
    const labelText = physicalProductsToggle.closest("label")?.querySelector("span");
    if (!physicalAvailable && labelText) {
      labelText.textContent = "Print and frame options paused";
    }
  }

  physicalProductsToggle?.addEventListener("change", () => {
    if (physicalProductsToggle.checked) {
      const confirmed = window.confirm("Show physical print and frame products on this localhost Owner session?");
      if (!confirmed) {
        physicalProductsToggle.checked = false;
        setStatus("Physical print and frame products remain hidden.");
        return;
      }
    }
    const enabled = productSettings?.setPhysicalProductsEnabled?.(physicalProductsToggle.checked) === true;
    physicalProductsToggle.checked = enabled;
    setStatus(enabled
      ? "Physical print and frame products are visible on localhost."
      : "Physical print and frame products are hidden; the site is digital-only."
    );
  });

  syncCountryKeywordsButton?.addEventListener("click", async () => {
    syncCountryKeywordsButton.disabled = true;
    setStatus("Syncing country metadata into generated catalog files. This can take a moment...");
    try {
      const result = await hiddenActions.syncCountryKeywords?.();
      const updates = result?.keyword_updates || {};
      const metadataCount = updates.metadata_changed || 0;
      const errorCount = updates.error_count || 0;
      renderCounts();
      loadR2Progress();
      setStatus(`Country metadata synced: ${metadataCount} catalog rows changed${errorCount ? `, ${errorCount} file errors` : ""}.`);
    } catch (error) {
      setStatus(error?.message || "Could not sync country metadata.");
    } finally {
      syncCountryKeywordsButton.disabled = false;
    }
  });

  keywordBlacklistForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const terms = normalizeKeywordTerms([keywordBlacklistInput?.value || ""]);
    if (!terms.length) {
      setKeywordBlacklistStatus("Enter a term to add.");
      return;
    }
    try {
      await saveKeywordBlacklist(terms);
    } catch (error) {
      setKeywordBlacklistStatus(error?.message || "Could not save keyword blacklist.");
    }
  });

  wipeHiddenR2Button?.addEventListener("click", async () => {
    const ok = window.confirm("Empty the Waste Basket? This purges public previews, private masters, and private render triplets for basketed photos, then leaves blacklist tombstones so those masters do not return.");
    if (!ok) return;
    wipeHiddenR2Button.disabled = true;
    setStatus("Queueing Waste Basket cloud media purge...");
    try {
      const result = await hiddenActions.wipeHiddenR2?.();
      renderCounts();
      await refreshDiscardedCount();
      await loadR2Coverage();
      await refreshBlockedSyncPanel();
      loadR2Progress();
      setStatus(`Waste Basket emptied: ${formatCount(result?.hidden_count || 0)} in basket, ${formatCount(result?.discarded_count || 0)} tombstones.`);
    } catch (error) {
      setStatus(error?.message || "Could not queue Waste Basket cloud media purge.");
    } finally {
      wipeHiddenR2Button.disabled = false;
    }
  });

  r2FixButton?.addEventListener("click", async () => {
    const authorized = await ownerAuth?.requireAuth?.("Start the local Photos By Elie server to repair R2 coverage.");
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

  refreshButtons.forEach((button) => {
    button.addEventListener("click", () => {
      refreshOwnerPanel(button.dataset.ownerRefresh || "");
    });
  });

  window.addEventListener("photosbyelie:hiddenchange", () => {
    renderCounts();
    refreshDiscardedCount();
    refreshBlockedSyncPanel();
  });

  reserveStore?.load?.().then(() => {
    if (ownerAuth?.state?.available) {
      renderCounts();
      refreshDiscardedCount();
      refreshBlockedSyncPanel();
    }
  });
  if (ownerAuth?.state?.available) {
    refreshCountsFromSource();
    refreshBlockedSyncPanel();
    loadR2Coverage();
    loadKeywordBlacklist();
    startR2Polling();
  }
})();
