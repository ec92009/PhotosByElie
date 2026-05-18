(async () => {
  await window.photosByElieCatalogReady;
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
  const basketStateNoteRoot = document.querySelector("[data-owner-basket-state-note]");
  const blockedPreviewProgressRoot = document.querySelector("[data-owner-blocked-preview-progress]");
  const blockedPreviewNoteRoot = document.querySelector("[data-owner-blocked-preview-note]");
  const syncCountryKeywordsButton = document.querySelector("[data-owner-sync-country-keywords]");
  const wipeHiddenR2Button = document.querySelector("[data-owner-wipe-hidden-r2]");
  const physicalProductsToggle = document.querySelector("[data-owner-physical-products]");
  const r2CoverageCard = document.querySelector("[data-owner-r2-coverage-card]");
  const r2CoverageSummary = document.querySelector("[data-owner-r2-coverage-summary]");
  const r2CoverageCounts = document.querySelector("[data-owner-r2-coverage-counts]");
  const r2CoverageMissing = document.querySelector("[data-owner-r2-coverage-missing]");
  const r2CoverageNote = document.querySelector("[data-owner-r2-coverage-note]");
  const r2FixButton = document.querySelector("[data-owner-r2-fix]");
  const r2Card = document.querySelector("[data-owner-r2-card]");
  const r2Summary = document.querySelector("[data-owner-r2-summary]");
  const r2Phases = document.querySelector("[data-owner-r2-phases]");
  const r2Counts = document.querySelector("[data-owner-r2-counts]");
  const priceListRoot = document.querySelector("[data-owner-price-list]");
  const costCard = document.querySelector("[data-owner-cost-card]");
  const costSummaryRoot = document.querySelector("[data-owner-cost-summary]");
  const costMtdRoot = document.querySelector("[data-owner-cost-mtd]");
  const costMonthRoot = document.querySelector("[data-owner-cost-month]");
  const costNextRoot = document.querySelector("[data-owner-cost-next]");
  const costStorageRoot = document.querySelector("[data-owner-cost-storage]");
  const costMtdNoteRoot = document.querySelector("[data-owner-cost-mtd-note]");
  const costMonthNoteRoot = document.querySelector("[data-owner-cost-month-note]");
  const costNextNoteRoot = document.querySelector("[data-owner-cost-next-note]");
  const costStorageNoteRoot = document.querySelector("[data-owner-cost-storage-note]");
  const costBreakdownRoot = document.querySelector("[data-owner-cost-breakdown]");
  const costNoteRoot = document.querySelector("[data-owner-cost-note]");
  const keywordBlacklistForm = document.querySelector("[data-owner-keyword-blacklist-form]");
  const keywordBlacklistInput = document.querySelector("[data-owner-keyword-blacklist-input]");
  const keywordBlacklistStatus = document.querySelector("[data-owner-keyword-blacklist-status]");
  const realEstateCard = document.querySelector("[data-owner-real-estate-card]");
  const realEstateClientList = document.querySelector("[data-owner-re-client-list]");
  const realEstateForm = document.querySelector("[data-owner-re-form]");
  const realEstateStatus = document.querySelector("[data-owner-re-status]");
  const realEstateOutput = document.querySelector("[data-owner-re-output]");
  const realEstateClientCountRoot = document.querySelector("[data-owner-re-client-count]");
  const realEstatePhotoCountRoot = document.querySelector("[data-owner-re-photo-count]");
  const realEstateAlbumCountRoot = document.querySelector("[data-owner-re-album-count]");
  const realEstateLocalLink = document.querySelector("[data-owner-re-local-link]");
  const realEstatePublicLink = document.querySelector("[data-owner-re-public-link]");
  const realEstateFields = Object.fromEntries(
    [...document.querySelectorAll("[data-owner-re-field]")]
      .map((field) => [field.dataset.ownerReField, field])
  );
  const realEstateComputed = Object.fromEntries(
    [...document.querySelectorAll("[data-owner-re-computed]")]
      .map((field) => [field.dataset.ownerReComputed, field])
  );
  const refreshButtons = [...document.querySelectorAll("[data-owner-refresh]")];
  const productSettings = window.photosByElieProductSettings;
  let r2PollTimer = null;
  let r2RepairLogToken = "";
  let r2RepairActive = false;
  let r2CoverageOk = false;
  let r2RepairLogSummary = null;
  let r2RepairLogTaskId = "";
  let wasteDeleteActive = false;
  let wasteCleanupActive = false;
  let lastWasteCoverageRefreshAt = 0;
  let latestR2ProgressTasks = [];
  let currentCostEstimate = null;
  let keywordBlacklistTerms = [];
  let realEstateClients = [];
  let selectedRealEstateClientId = "";
  let realEstateBusy = false;
  let realEstateProgressTimer = null;

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
    ["discard-start", "Delete banned R2 objects"],
    ["camera", "Import Camera sources"],
    ["leonardo", "Import Leonardo sources"],
    ["catalog", "Export catalog"],
    ["worker", "Write worker catalog"],
    ["sidecar", "Write media sidecar"],
    ["private", "Backfill private JPGs"],
    ["discard-final", "Final banned R2 cleanup"],
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
      loadCostEstimate();
      loadKeywordBlacklist();
      loadRealEstateOwner();
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

  const formatCount = (value) => Number(value || 0).toLocaleString();
  const numberFromLog = (value) => Number(String(value || "").replace(/,/g, "")) || 0;
  const formatDuration = (seconds) => {
    const wholeSeconds = Math.max(0, Math.round(Number(seconds) || 0));
    const hours = Math.floor(wholeSeconds / 3600);
    const minutes = Math.floor((wholeSeconds % 3600) / 60);
    const remainingSeconds = wholeSeconds % 60;
    if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
    if (minutes) return `${minutes}m ${String(remainingSeconds).padStart(2, "0")}s`;
    return `${remainingSeconds}s`;
  };

  const withTimeout = (promise, ms, label) => {
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = window.setTimeout(() => reject(new Error(`${label} is taking longer than expected.`)), ms);
    });
    return Promise.race([
      Promise.resolve(promise).finally(() => window.clearTimeout(timer)),
      timeout,
    ]);
  };

  const formatMoney = (value) => {
    const amount = Number(value || 0);
    return Number.isFinite(amount) ? `$${amount.toFixed(amount % 1 ? 2 : 0)}` : "$0";
  };

  const formatMoneyDetailed = (value) => {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount) || amount <= 0) return "$0.00";
    if (amount < 0.01) return "<$0.01";
    return `$${amount.toFixed(2)}`;
  };

  const cloudCostModel = {
    r2: {
      storageUsdPerGbMonth: 0.015,
      freeTierGbMonth: 10,
      classAFreeTier: 1_000_000,
      classBFreeTier: 10_000_000,
      classAUsdPerMillion: 4.5,
      classBUsdPerMillion: 0.36,
      pricingUrl: "https://developers.cloudflare.com/r2/pricing/",
    },
    workers: {
      paidBaseUsdPerMonth: 5,
      includedRequests: 10_000_000,
      includedCpuMs: 30_000_000,
      requestUsdPerMillion: 0.30,
      cpuUsdPerMillionMs: 0.02,
      pricingUrl: "https://developers.cloudflare.com/workers/platform/pricing/",
    },
  };

  const monthWindow = (now = new Date()) => {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const elapsedMs = Math.min(Math.max(now - start, 0), end - start);
    const elapsedRatio = (end - start) ? elapsedMs / (end - start) : 0;
    const monthLabel = now.toLocaleString([], { month: "short", year: "numeric" });
    const nextMonthLabel = end.toLocaleString([], { month: "short", year: "numeric" });
    return { start, end, elapsedRatio, monthLabel, nextMonthLabel };
  };

  const usdForStorageBytes = (bytes, pricing = cloudCostModel.r2, includeFreeTier = true) => {
    const gbMonth = Number(bytes || 0) / 1_000_000_000;
    const billableGbMonth = includeFreeTier
      ? Math.max(0, gbMonth - Number(pricing.freeTierGbMonth || 0))
      : gbMonth;
    return billableGbMonth * Number(pricing.storageUsdPerGbMonth || 0);
  };

  const estimateStorageMonthlyUsd = (estimate = {}) => {
    const fromEstimate = Number(estimate?.cost?.currentMonthlyUsdAfterFreeTier);
    if (Number.isFinite(fromEstimate)) return fromEstimate;
    const pricing = {
      ...cloudCostModel.r2,
      ...(estimate?.pricing || {}),
    };
    return usdForStorageBytes(estimate?.current?.totalBytes, pricing, true);
  };

  const defaultPriceTiers = {
    original: { label: "Camera photo" },
    ai: { label: "AI image" },
  };

  const ensureOwnerPriceTiers = () => {
    window.photosByEliePriceTiers = {
      ...defaultPriceTiers,
      ...(window.photosByEliePriceTiers || {}),
    };
  };

  const productLabel = (option) => window.photosByElieProductLabel?.(option) || option?.label || option?.id || "";
  const productDetail = (option) => option?.detail || "";
  const renderPriceList = () => {
    if (!priceListRoot) return;
    ensureOwnerPriceTiers();
    productSettings?.applyPriceOverrides?.();
    const options = window.photosByElieResolutions || [];
    const frames = window.photosByElieFrameOptions || [];
    const digitalOptions = options.filter((option) => option.type !== "print");
    const printOptions = options.filter((option) => option.type === "print");
    const priceTiers = window.photosByEliePriceTiers || defaultPriceTiers;
    const digitalTierIds = Object.keys(priceTiers);
    const digitalTierColumnSpan = Math.max(1, digitalTierIds.length);
    const videoTiers = window.photosByElieVideoPriceTiers || {};
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
    const videoRows = Object.entries(videoTiers).map(([tierId, tier]) => `
      <tr>
        <th scope="row">${escapeHtml(tier?.label || tierId)}</th>
        <td>Original video download</td>
        <td colspan="${digitalTierColumnSpan}">${priceInput({
          kind: "video-tier",
          id: tierId,
          value: Number(tier?.price) || 0,
          label: `${tier?.label || tierId} video price`,
        })}</td>
        <td>Digital delivery</td>
        <td>No S&amp;H</td>
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
          ${videoRows}
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
        } else if (input.dataset.ownerPriceKind === "video-tier") {
          overrides.videoPriceTiers = { ...(overrides.videoPriceTiers || {}), [input.dataset.ownerPriceId]: value };
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

  const renderCostEstimate = (estimate = null) => {
    if (!costCard || !costSummaryRoot || !costBreakdownRoot) return;
    currentCostEstimate = estimate;
    if (!estimate) {
      setText(costSummaryRoot, "Cloud cost estimate is unavailable.");
      if (costMtdRoot) costMtdRoot.textContent = "$0.00";
      if (costMonthRoot) costMonthRoot.textContent = "$0.00";
      if (costNextRoot) costNextRoot.textContent = "$0.00";
      if (costStorageRoot) costStorageRoot.textContent = "0 B";
      setHtml(costBreakdownRoot, "");
      if (costNoteRoot) costNoteRoot.textContent = "Run the storage estimate after the helper can reach R2.";
      return;
    }
    const windowState = monthWindow();
    const storageMonthlyUsd = estimateStorageMonthlyUsd(estimate);
    const storageMtdUsd = storageMonthlyUsd * windowState.elapsedRatio;
    const workerBaseUsd = Number(cloudCostModel.workers.paidBaseUsdPerMonth || 0);
    const storageBytes = Number(estimate?.current?.totalBytes || 0);
    const updatedAt = estimate?.updatedAt ? new Date(estimate.updatedAt) : null;
    const updatedLabel = updatedAt && Number.isFinite(updatedAt.getTime())
      ? updatedAt.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
      : "unknown time";
    const paidWorkerTotal = storageMonthlyUsd + workerBaseUsd;
    if (costMtdRoot) costMtdRoot.textContent = formatMoneyDetailed(storageMtdUsd);
    if (costMonthRoot) costMonthRoot.textContent = formatMoneyDetailed(storageMonthlyUsd);
    if (costNextRoot) costNextRoot.textContent = formatMoneyDetailed(storageMonthlyUsd);
    if (costStorageRoot) costStorageRoot.textContent = formatBytes(storageBytes);
    if (costMtdNoteRoot) costMtdNoteRoot.textContent = `${Math.round(windowState.elapsedRatio * 100)}% of ${windowState.monthLabel}`;
    if (costMonthNoteRoot) costMonthNoteRoot.textContent = `Storage; ${formatMoneyDetailed(paidWorkerTotal)} with Workers Paid`;
    if (costNextNoteRoot) costNextNoteRoot.textContent = windowState.nextMonthLabel;
    if (costStorageNoteRoot) costStorageNoteRoot.textContent = `Updated ${updatedLabel}`;
    setText(
      costSummaryRoot,
      `Measured R2 storage is ${formatMoneyDetailed(storageMonthlyUsd)}/month after the ${formatCount(cloudCostModel.r2.freeTierGbMonth)} GB-month free tier. Add ${formatMoneyDetailed(workerBaseUsd)}/month if the Cloudflare account is on Workers Paid; request and CPU overages need analytics.`
    );
    const rows = [
      {
        item: "R2 storage",
        rate: `${formatMoneyDetailed(storageMonthlyUsd)}/mo at ${formatBytes(storageBytes)} stored`,
        mtd: formatMoneyDetailed(storageMtdUsd),
        month: formatMoneyDetailed(storageMonthlyUsd),
        next: formatMoneyDetailed(storageMonthlyUsd),
      },
      {
        item: "R2 operations",
        rate: `Class A ${formatCount(cloudCostModel.r2.classAFreeTier)} free/mo, Class B ${formatCount(cloudCostModel.r2.classBFreeTier)} free/mo`,
        mtd: "Needs Cloudflare usage telemetry",
        month: "Not counted locally",
        next: "Not counted locally",
      },
      {
        item: "Workers plan",
        rate: `${formatMoneyDetailed(workerBaseUsd)}/mo if Workers Paid is enabled`,
        mtd: `Up to ${formatMoneyDetailed(workerBaseUsd)} if active`,
        month: `+${formatMoneyDetailed(workerBaseUsd)} if active`,
        next: `+${formatMoneyDetailed(workerBaseUsd)} if active`,
      },
      {
        item: "Workers requests and CPU",
        rate: `${formatCount(cloudCostModel.workers.includedRequests)} requests and ${formatCount(cloudCostModel.workers.includedCpuMs)} CPU-ms included on Paid`,
        mtd: "Needs Worker analytics",
        month: "Overage unknown",
        next: "Overage unknown",
      },
    ];
    setHtml(costBreakdownRoot, `
      <table class="owner-cost-table">
        <thead>
          <tr>
            <th scope="col">Line item</th>
            <th scope="col">Current rate</th>
            <th scope="col">Consumed MTD</th>
            <th scope="col">Expected bill</th>
            <th scope="col">Next month</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <th scope="row">${escapeHtml(row.item)}</th>
              <td>${escapeHtml(row.rate)}</td>
              <td><strong>${escapeHtml(row.mtd)}</strong></td>
              <td><strong>${escapeHtml(row.month)}</strong></td>
              <td><strong>${escapeHtml(row.next)}</strong></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `);
    if (costNoteRoot) {
      const avoided = Number(estimate?.cost?.avoidedMonthlyUsdEstimate || 0);
      const activeEmptyTask = (latestR2ProgressTasks || []).find((task) =>
        isWasteBasketEmptyTask(task) && (task.state === "queued" || task.state === "running")
      );
      if (activeEmptyTask && avoided > 0) {
        const total = Number(activeEmptyTask.total || 0);
        const completed = Number(activeEmptyTask.completed || 0);
        const removedRatio = total ? Math.max(0, Math.min(1, completed / total)) : 0;
        const removedUsd = avoided * removedRatio;
        const pendingUsd = Math.max(0, avoided - removedUsd);
        costNoteRoot.textContent = `Storage scan: ${updatedLabel}. Waste Basket purge in progress: about ${formatMoneyDetailed(removedUsd)}/month removed so far, ${formatMoneyDetailed(pendingUsd)}/month still deleting, ${formatMoneyDetailed(avoided)}/month total expected savings. R2 operation and Worker CPU/request usage need Cloudflare analytics before the estimate is a full invoice.`;
      } else {
        costNoteRoot.textContent = `Storage scan: ${updatedLabel}. Waste Basket cleanup avoided about ${formatMoneyDetailed(avoided)}/month. R2 egress is zero-rated; operation and Worker CPU/request usage need Cloudflare analytics before the estimate is a full invoice.`;
      }
    }
  };

  const loadCostEstimate = async () => {
    if (!costCard) return;
    try {
      const href = window.photosByElieVersionedHref?.("./assets/storage-estimate.json") || "./assets/storage-estimate.json";
      const response = await fetch(href, { cache: "no-store" });
      if (!response.ok) throw new Error(`storage estimate ${response.status}`);
      renderCostEstimate(await response.json());
    } catch {
      renderCostEstimate(null);
    }
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

  const setRealEstateStatus = (message) => {
    if (realEstateStatus) realEstateStatus.textContent = message;
  };

  const setRealEstateBusy = (busy) => {
    realEstateBusy = busy;
    if (realEstateCard) {
      realEstateCard.querySelectorAll("button, input, textarea").forEach((control) => {
        if (control.dataset.ownerReAction === "new-client") {
          control.disabled = false;
          return;
        }
        control.disabled = busy;
      });
    }
    setRefreshBusy("real-estate", busy);
  };

  const selectedRealEstateClient = () => (
    selectedRealEstateClientId
      ? realEstateClients.find((client) => client.id === selectedRealEstateClientId) || null
      : null
  );

  const renderRealEstateOutput = (value = "", forceOpen = false) => {
    if (!realEstateOutput) return;
    const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    realEstateOutput.textContent = text;
    realEstateOutput.hidden = !forceOpen && !text;
  };

  const updateRealEstateLinks = (client) => {
    if (realEstateLocalLink) {
      realEstateLocalLink.href = client?.localContextExists ? client.localReviewUrl : "./real-estate.html?logout=1";
      realEstateLocalLink.toggleAttribute("aria-disabled", !client?.localContextExists);
    }
    if (realEstatePublicLink) {
      realEstatePublicLink.href = client?.publicContextExists ? client.publicReviewUrl : "./real-estate.html?logout=1";
      realEstatePublicLink.toggleAttribute("aria-disabled", !client?.publicContextExists);
    }
  };

  const realEstatePropertiesFor = (client) => (
    client?.properties?.length ? client.properties : (client?.effectiveProperties || client?.availableProperties || client?.albums || [])
  );

  const realEstateConventionsFor = (clientName) => {
    const name = String(clientName || "").trim();
    return {
      sourceRoot: name ? `/Volumes/Saturn/Pictures/RE/${name}` : "/Volumes/Saturn/Pictures/RE/<Client>",
      username: name || "<Client>",
      slug: name || "<Client>",
      galleryKey: name ? `${name}-gallery` : "<Client>-gallery",
      galleryTitle: name || "<Client>",
      publicKeyPrefix: name ? `RE/${name}/previews` : "RE/<Client>/previews",
      privateKeyPrefix: name ? `RE/${name}/masters` : "RE/<Client>/masters",
    };
  };

  const updateRealEstateComputed = (clientNameOrClient) => {
    const clientName = typeof clientNameOrClient === "string"
      ? clientNameOrClient
      : (clientNameOrClient?.customer || "");
    const conventions = realEstateConventionsFor(clientName);
    Object.entries(conventions).forEach(([key, value]) => {
      if (realEstateComputed[key]) realEstateComputed[key].textContent = value;
    });
  };

  const blankRealEstateClient = () => ({
    id: "",
    customer: "",
    email: "",
    accessCode: "",
    maxItems: 300,
    properties: [],
    effectiveProperties: [],
  });

  const fillRealEstateForm = (client) => {
    if (!client || !realEstateForm) return;
    selectedRealEstateClientId = client.id || "";
    const values = {
      id: client.id || "",
      customer: client.customer || "",
      email: client.email || "",
      accessCode: client.accessCode || "",
      properties: realEstatePropertiesFor(client).join("\n"),
      maxItems: client.maxItems || 300,
    };
    Object.entries(values).forEach(([key, value]) => {
      if (realEstateFields[key]) realEstateFields[key].value = value ?? "";
    });
    updateRealEstateComputed(client);
    updateRealEstateLinks(client);
  };

  const renderRealEstateClients = () => {
    if (!realEstateCard) return;
    const selected = selectedRealEstateClient();
    if (realEstateClientCountRoot) realEstateClientCountRoot.textContent = formatCount(realEstateClients.length);
    if (realEstatePhotoCountRoot) {
      realEstatePhotoCountRoot.textContent = formatCount(realEstateClients.reduce((sum, client) => sum + Number(client.stats?.photoCount || 0), 0));
    }
    if (realEstateAlbumCountRoot) {
      realEstateAlbumCountRoot.textContent = formatCount(realEstateClients.reduce((sum, client) => sum + Math.max(
        Number(client.stats?.albumCount || 0),
        realEstatePropertiesFor(client).length
      ), 0));
    }
    if (realEstateClientList) {
      realEstateClientList.innerHTML = realEstateClients.length ? realEstateClients.map((client) => {
        const active = client.id === selected?.id;
        const properties = realEstatePropertiesFor(client);
        const missingProperties = client.missingProperties || [];
        const statusBits = [
          missingProperties.length
            ? `skipping: ${missingProperties.join(", ")}`
            : (client.sourceRootExists ? "source ok" : "source missing"),
          client.publicContextExists ? "published" : "not published",
        ];
        return `
          <tr class="${active ? "is-active" : ""}" data-owner-re-client="${escapeHtml(client.id)}">
            <td><strong>${escapeHtml(client.customer || client.id)}</strong></td>
            <td>${escapeHtml(client.email || "")}</td>
            <td><code>${escapeHtml(client.accessCode || "")}</code></td>
            <td>${escapeHtml(properties.join(", ") || "All folders")}</td>
            <td>${escapeHtml(formatCount(client.stats?.photoCount || 0))}</td>
            <td>${escapeHtml(statusBits.join(" / "))}</td>
            <td>
              <div class="owner-real-estate-row-actions">
                <button class="btn secondary" type="button" data-owner-re-row-action="edit" data-owner-re-client-id="${escapeHtml(client.id)}">Edit</button>
                <button class="btn secondary danger" type="button" data-owner-re-row-action="delete" data-owner-re-client-id="${escapeHtml(client.id)}">Delete</button>
              </div>
            </td>
          </tr>
        `;
      }).join("") : `<tr><td colspan="7">No real estate clients yet. Create one below.</td></tr>`;
    }
    fillRealEstateForm(selected || blankRealEstateClient());
  };

  const loadRealEstateOwner = async () => {
    if (!realEstateCard) return;
    setRealEstateStatus("Loading real estate clients...");
    try {
      const response = await fetch("/__photosbyelie/real-estate-owner", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Could not load real estate clients.");
      realEstateClients = Array.isArray(payload.clients) ? payload.clients : [];
      if (!selectedRealEstateClientId || !realEstateClients.some((client) => client.id === selectedRealEstateClientId)) {
        selectedRealEstateClientId = realEstateClients[0]?.id || "";
      }
      renderRealEstateClients();
      const selected = selectedRealEstateClient();
      setRealEstateStatus(selected
        ? `${selected.customer}: ${formatCount(selected.stats?.photoCount || 0)} photos, ${selected.passwordSet ? "password set" : "password needed"}.`
        : "No real estate clients configured.");
      renderRealEstateOutput("");
    } catch (error) {
      setRealEstateStatus(error?.message || "Could not load real estate clients.");
    }
  };

  const realEstateFormPayload = () => ({
    id: realEstateFields.id?.value || "",
    customer: realEstateFields.customer?.value || "",
    email: realEstateFields.email?.value || "",
    accessCode: realEstateFields.accessCode?.value || "",
    properties: realEstateFields.properties?.value || "",
    maxItems: realEstateFields.maxItems?.value || 300,
  });

  const postRealEstateOwnerAction = async (body) => {
    const response = await fetch("/__photosbyelie/real-estate-owner", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Real estate action failed.");
    return payload;
  };

  const realEstateImportProgressMessage = (clientName, progress = {}) => {
    const total = Number(progress.total || 0);
    const completed = Number(progress.completed || 0);
    const skipped = Array.isArray(progress.skippedProperties) ? progress.skippedProperties : [];
    const currentAlbum = progress.album ? ` (${progress.album})` : "";
    const skippedText = skipped.length ? ` Skipping missing: ${skipped.join(", ")}.` : "";
    if (total > 0) {
      return `Importing ${clientName}: ${formatCount(completed)} / ${formatCount(total)} media${currentAlbum}.${skippedText}`;
    }
    return `Importing ${clientName}: scanning available media.${skippedText}`;
  };

  const stopRealEstateImportProgress = () => {
    if (realEstateProgressTimer) {
      window.clearInterval(realEstateProgressTimer);
      realEstateProgressTimer = null;
    }
  };

  const startRealEstateImportProgress = (operationId, clientName) => {
    stopRealEstateImportProgress();
    if (!operationId) return;
    const refresh = async () => {
      try {
        const response = await fetch(`/__photosbyelie/real-estate-import-progress?operation_id=${encodeURIComponent(operationId)}`, { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        const progress = payload?.progress;
        if (!response.ok || !progress) return;
        setRealEstateStatus(realEstateImportProgressMessage(clientName, progress));
        if (progress.state === "done" || progress.state === "failed") stopRealEstateImportProgress();
      } catch {
        // The import request itself will report any hard failure.
      }
    };
    refresh();
    realEstateProgressTimer = window.setInterval(refresh, 700);
  };

  const saveRealEstateClient = async () => {
    setRealEstateBusy(true);
    setRealEstateStatus("Saving real estate client...");
    try {
      const payload = await postRealEstateOwnerAction({
        action: "save-client",
        client: realEstateFormPayload(),
      });
      realEstateClients = Array.isArray(payload.clients) ? payload.clients : realEstateClients;
      selectedRealEstateClientId = payload.client?.id || selectedRealEstateClientId;
      renderRealEstateClients();
      renderRealEstateOutput("");
      setRealEstateStatus(`${payload.client?.customer || "Client"} saved.`);
    } catch (error) {
      setRealEstateStatus(error?.message || "Could not save real estate client.");
    } finally {
      setRealEstateBusy(false);
    }
  };

  const startNewRealEstateClient = () => {
    selectedRealEstateClientId = "";
    fillRealEstateForm(blankRealEstateClient());
    renderRealEstateOutput("");
    setRealEstateStatus("Enter a client name, email, password, and property folders.");
  };

  const deleteRealEstateClient = async (clientId = selectedRealEstateClientId) => {
    const client = realEstateClients.find((item) => item.id === clientId);
    if (!client) {
      setRealEstateStatus("Select a real estate client to delete.");
      return;
    }
    const ok = window.confirm(`Delete ${client.customer} from the local Real Estate client list? Imported media and published contexts are left on disk.`);
    if (!ok) return;
    setRealEstateBusy(true);
    setRealEstateStatus(`Deleting ${client.customer}...`);
    try {
      const payload = await postRealEstateOwnerAction({
        action: "delete-client",
        id: client.id,
      });
      realEstateClients = Array.isArray(payload.clients) ? payload.clients : [];
      selectedRealEstateClientId = realEstateClients[0]?.id || "";
      renderRealEstateClients();
      renderRealEstateOutput("");
      setRealEstateStatus(`${client.customer} deleted from the local client list.`);
    } catch (error) {
      setRealEstateStatus(error?.message || "Could not delete real estate client.");
    } finally {
      setRealEstateBusy(false);
    }
  };

  const runRealEstateClientAction = async (action) => {
    if (realEstateBusy) return;
    if (action === "new-client") {
      startNewRealEstateClient();
      return;
    }
    if (action === "delete-client") {
      deleteRealEstateClient();
      return;
    }
    const selected = selectedRealEstateClient();
    if (!selected) {
      setRealEstateStatus("Save a real estate client first.");
      return;
    }
    if (action === "upload-client") {
      const ok = window.confirm("Upload public previews and private masters for this real estate client?");
      if (!ok) return;
    }
    setRealEstateBusy(true);
    const labels = {
      "import-client": "Importing previews...",
      "publish-client": "Publishing context...",
      "upload-dry-run": "Checking upload inventory...",
      "upload-client": "Uploading masters and previews...",
      "worker-secret": "Preparing Worker secret...",
    };
    setRealEstateStatus(labels[action] || "Running real estate action...");
    const operationId = action === "import-client"
      ? `re-import-${selected.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`
      : "";
    if (operationId) startRealEstateImportProgress(operationId, selected.customer || selected.id);
    try {
      const payload = await postRealEstateOwnerAction({
        action,
        id: selected.id,
        operationId,
      });
      if (payload.client) {
        const byId = new Map(realEstateClients.map((client) => [client.id, client]));
        byId.set(payload.client.id, payload.client);
        realEstateClients = [...byId.values()].sort((a, b) => String(a.customer).localeCompare(String(b.customer)));
        selectedRealEstateClientId = payload.client.id;
        renderRealEstateClients();
      }
      if (action === "worker-secret") {
        const secretText = payload.secretJson || "[]";
        renderRealEstateOutput(`${payload.wranglerCommand}\n\n${secretText}`, true);
        await navigator.clipboard?.writeText(secretText).catch(() => {});
        setRealEstateStatus(`Worker secret prepared for ${formatCount(payload.galleryCount || 0)} real estate galleries.`);
      } else {
        renderRealEstateOutput(payload.summary || payload.command?.output || payload, true);
        const clientName = payload.client?.customer || selected.customer;
        const importProgress = payload.importProgress || null;
        const skipped = Array.isArray(importProgress?.skippedProperties) ? importProgress.skippedProperties : [];
        const doneLabels = {
          "import-client": importProgress
            ? `${clientName} previews imported: ${formatCount(importProgress.completed || 0)} / ${formatCount(importProgress.total || 0)} media.${skipped.length ? ` Skipped missing: ${skipped.join(", ")}.` : ""}`
            : `${clientName} previews imported.`,
          "publish-client": `${clientName} context published.`,
          "upload-dry-run": `${clientName} upload dry run complete.`,
          "upload-client": `${clientName} upload complete.`,
        };
        setRealEstateStatus(doneLabels[action] || "Real estate action complete.");
      }
    } catch (error) {
      setRealEstateStatus(error?.message || "Real estate action failed.");
    } finally {
      if (operationId) stopRealEstateImportProgress();
      setRealEstateBusy(false);
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
    const activeEmptyTask = (latestR2ProgressTasks || []).find((task) =>
      isWasteBasketEmptyTask(task) && (task.state === "queued" || task.state === "running")
    );
    if (activeEmptyTask) {
      const total = Number(activeEmptyTask.total || 0);
      const completed = Number(activeEmptyTask.completed || 0);
      if (blockedPreviewCountRoot) blockedPreviewCountRoot.textContent = formatCount(Math.max(0, total - completed));
      if (blockedPreviewNoteRoot) {
        blockedPreviewNoteRoot.textContent = "R2 purge is in progress: the undo queue is already cleared, ban tombstones are preserved, and R2 is deleting the remaining public previews, private masters, and private render files.";
      }
      return;
    }
    const blockedCloudMedia = blockedCloudMediaCountFromCoverage();
    if (blockedPreviewCountRoot) blockedPreviewCountRoot.textContent = formatCount(blockedCloudMedia);
    if (blockedPreviewNoteRoot) {
      blockedPreviewNoteRoot.textContent = blockedCloudMedia
        ? `${formatCount(blockedCloudMedia)} cloud media copies are still present. Preview cleanup checks old public objects; In basket drops only when R2 purge clears the live undo queue and writes tombstones.`
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
      setText(r2CoverageNote, "Repair is running. Banned photos stay banned; this only removes their old R2 objects.");
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
    const deleted = lastMatch(/^Done\. (?:Would delete|Deleted) ([0-9,]+) public and ([0-9,]+) private object references for ([0-9,]+) discarded photos\./);
    const deleteStart = lastMatch(/^DELETE_START\s+([0-9,]+)\s+([0-9,]+)\s+([0-9,]+)\s+([0-9,]+)/);
    const deleteProgress = lastMatch(/^DELETE_PROGRESS\s+([0-9,]+)\s+([0-9,]+)\s+([0-9,]+)\s+([0-9,]+)\s+([0-9,]+)/);
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
    if (deleteProgress || deleteStart) phase = "Deleting R2 objects for banned photos";
    if (deleted) phase = "Deleted R2 objects for banned photos";
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
      else if (deleted || deleteProgress || deleteStart) phaseKey = "discard-start";
      else phaseKey = "prepare";
    }
    return { latest, phase, phaseKey, doneKeys, deleted, deleteStart, deleteProgress, scan, started, imported, upload, processed, manifest, error };
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

  const deleteObjectProgress = (logSummary) => {
    const progress = logSummary?.deleteProgress;
    const started = logSummary?.deleteStart;
    const completed = numberFromLog(progress?.match?.[1]);
    const total = numberFromLog(progress?.match?.[2] || started?.match?.[1]);
    const elapsedSeconds = numberFromLog(progress?.match?.[5]);
    const publicCompleted = numberFromLog(progress?.match?.[3]);
    const privateCompleted = numberFromLog(progress?.match?.[4]);
    const publicTotal = numberFromLog(started?.match?.[2]);
    const privateTotal = numberFromLog(started?.match?.[3]);
    const discardedPhotos = numberFromLog(started?.match?.[4] || logSummary?.deleted?.match?.[3]);
    const percent = total
      ? Math.min(completed >= total ? 100 : 99, Math.max(completed ? 1 : 0, Math.round((completed / total) * 100)))
      : 18;
    const secondsLeft = completed > 0 && total > completed && elapsedSeconds > 0
      ? ((total - completed) / completed) * elapsedSeconds
      : 0;
    const countdown = secondsLeft ? `${formatDuration(secondsLeft)} left` : (total && completed >= total ? "0s left" : "Calculating time left");
    const detail = total
      ? `${formatCount(completed)} / ${formatCount(total)} objects, ${countdown}`
      : "Finding banned R2 objects";
    return {
      percent,
      detail,
      completed,
      total,
      publicCompleted,
      privateCompleted,
      publicTotal,
      privateTotal,
      discardedPhotos,
      countdown,
    };
  };

  const phaseProgress = (phase, logSummary, failed) => {
    if (failed) return { percent: 100, detail: phase.key === "coverage" ? coverageMissingDetail() : "Needs attention" };
    if ((phase.key === "discard-start" || phase.key === "discard-final") && (logSummary?.deleteProgress || logSummary?.deleteStart || logSummary?.deleted)) {
      if (logSummary?.deleted) {
        return { percent: 100, detail: `${logSummary.deleted.match[1]} public, ${logSummary.deleted.match[2]} private` };
      }
      return deleteObjectProgress(logSummary);
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
    if ((phase.key === "discard-start" || phase.key === "discard-final") && logSummary?.deleted) {
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
    if (logSummary?.deleteStart || logSummary?.deleteProgress || logSummary?.deleted) {
      const progress = deleteObjectProgress(logSummary);
      if (progress.total) rows.push(["R2 objects", `${formatCount(progress.completed)} / ${formatCount(progress.total)}`]);
      if (active && progress.countdown) rows.push(["Countdown", progress.countdown]);
      if (progress.publicTotal || progress.privateTotal) {
        rows.push([
          "Public/private",
          `${formatCount(progress.publicCompleted)} / ${formatCount(progress.publicTotal)} public, ${formatCount(progress.privateCompleted)} / ${formatCount(progress.privateTotal)} private`,
        ]);
      }
      if (progress.discardedPhotos) rows.push(["Banned photos", formatCount(progress.discardedPhotos)]);
    }
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

  const isWasteDeleteTask = (task) => {
    if (!task || task.operation !== "delete") return false;
    const kind = String(task.kind || "").toLowerCase();
    const photoId = String(task.photo_id || "").toLowerCase();
    return kind.includes("hidden-public")
      || kind.includes("waste")
      || kind.includes("basket")
      || photoId.includes("hidden-public");
  };

  const isWasteBasketEmptyTask = (task) => {
    const kind = String(task?.kind || "").toLowerCase();
    const photoId = String(task?.photo_id || "").toLowerCase();
    return kind.includes("waste-basket") || photoId.includes("waste-basket");
  };

  const taskTimestamp = (task) => Date.parse(task?.updated_at || task?.started_at || task?.queued_at || "") || 0;

  const compareWasteProgress = (a, b) => {
    const completedDelta = Number(b?.completed || 0) - Number(a?.completed || 0);
    return completedDelta || taskTimestamp(b) - taskTimestamp(a);
  };

  const wasteProgressSummary = (task) => {
    const total = Number(task?.total || 0);
    const completed = Number(task?.completed || 0);
    const kind = String(task?.kind || "").toLowerCase();
    const photoId = String(task?.photo_id || "").toLowerCase();
    const publicPreviewOnly = kind.includes("hidden-public") || photoId.includes("hidden-public");
    if (publicPreviewOnly && total) {
      const photoTotal = Math.ceil(total / 2);
      const photoCompleted = Math.min(photoTotal, Math.ceil(completed / 2));
      return `${formatCount(photoCompleted)} / ${formatCount(photoTotal)} preview checks`;
    }
    return total
      ? `${formatCount(completed)} / ${formatCount(total)} cloud objects`
      : `${formatCount(completed)} cloud objects`;
  };

  const wasteProgressRateSummary = (task) => {
    const total = Number(task?.total || 0);
    const completed = Number(task?.completed || 0);
    const startedAt = Date.parse(task?.started_at || task?.queued_at || "");
    if (!total || !completed || !startedAt) return "";
    const elapsedSeconds = Math.max(1, (Date.now() - startedAt) / 1000);
    const perMinute = completed / elapsedSeconds * 60;
    if (!Number.isFinite(perMinute) || perMinute <= 0) return "";
    const remaining = Math.max(0, total - completed);
    const etaLabel = formatDuration((remaining / perMinute) * 60);
    return `about ${Math.max(1, Math.round(perMinute))}/min, ETA ${etaLabel}`;
  };

  const renderWasteBasketProgress = (tasks = []) => {
    const wasteTasks = tasks.filter(isWasteDeleteTask);
    const activeTasks = wasteTasks.filter((task) => task.state === "queued" || task.state === "running");
    const activeEmptyTasks = activeTasks.filter(isWasteBasketEmptyTask);
    const taskPool = activeEmptyTasks.length ? activeEmptyTasks : activeTasks.length ? activeTasks : wasteTasks;
    const [latestWasteTask] = [...taskPool]
      .sort(activeTasks.length ? compareWasteProgress : (a, b) => taskTimestamp(b) - taskTimestamp(a));
    wasteCleanupActive = activeTasks.length > 0;
    wasteDeleteActive = activeEmptyTasks.length > 0;
    if (wipeHiddenR2Button) {
      wipeHiddenR2Button.disabled = wasteDeleteActive;
      wipeHiddenR2Button.textContent = wasteDeleteActive ? "Purging..." : "Purge R2 copies";
    }
    if (basketStateNoteRoot) {
      basketStateNoteRoot.textContent = wasteDeleteActive ? "Purging R2 copies" : "Undo queue";
    }
    if (!blockedPreviewProgressRoot) return;
    if (!latestWasteTask) {
      blockedPreviewProgressRoot.hidden = true;
      blockedPreviewProgressRoot.textContent = "";
      return;
    }
    const failed = Number(latestWasteTask.failed || 0);
    const state = latestWasteTask.state || "queued";
    const prefix = state === "done" ? "Last cleanup" : failed ? "Needs attention" : "Cleanup";
    const suffix = failed ? `, ${formatCount(failed)} failed` : "";
    const rate = wasteProgressRateSummary(latestWasteTask);
    blockedPreviewProgressRoot.hidden = false;
    blockedPreviewProgressRoot.textContent = `${prefix}: ${wasteProgressSummary(latestWasteTask)}${rate ? `, ${rate}` : ""}${suffix}`;
    if (blockedPreviewCountRoot && isWasteBasketEmptyTask(latestWasteTask)) {
      const total = Number(latestWasteTask.total || 0);
      const completed = Number(latestWasteTask.completed || 0);
      blockedPreviewCountRoot.textContent = formatCount(Math.max(0, total - completed));
      if (blockedPreviewNoteRoot) {
        blockedPreviewNoteRoot.textContent = "R2 purge is in progress: the undo queue is already cleared, ban tombstones are preserved, and R2 is deleting the remaining public previews, private masters, and private render files.";
      }
    }
  };

  const renderR2Progress = (tasks = []) => {
    latestR2ProgressTasks = tasks;
    renderWasteBasketProgress(tasks);
    if (currentCostEstimate) renderCostEstimate(currentCostEstimate);
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

  const renderR2Coverage = (coverage = null) => {
    if (!r2CoverageCard || !r2CoverageSummary || !r2CoverageCounts || !r2CoverageNote) return;
    if (!coverage) {
      r2CoverageOk = false;
      r2CoverageSummary.textContent = "R2 coverage is unavailable.";
      r2CoverageCounts.innerHTML = "";
      if (r2CoverageMissing) {
        r2CoverageMissing.hidden = true;
        r2CoverageMissing.innerHTML = "";
      }
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
    const missingPrivateDelivery = Array.isArray(coverage.missingPrivateDelivery)
      ? coverage.missingPrivateDelivery
      : [];
    if (r2CoverageMissing) {
      r2CoverageMissing.hidden = missingPrivateDelivery.length === 0;
      r2CoverageMissing.innerHTML = missingPrivateDelivery.length ? `
        <h3>Missing private delivery files</h3>
        <p>${escapeHtml(formatCount(missingPrivateDelivery.length))} shown. Fix it runs the Saturn-backed sweep, uploads missing masters when the source file exists, and rebuilds missing JPG triplets.</p>
        <div class="owner-coverage-missing-list">
          ${missingPrivateDelivery.slice(0, 12).map((item) => `
            <div class="owner-coverage-missing-row">
              <strong>${escapeHtml(item.photoId)}</strong>
              <span>${escapeHtml(item.productLabel || item.productId || item.kind || "Delivery file")}</span>
              <code>${escapeHtml(item.objectKey || "")}</code>
              <small>${escapeHtml(item.sourceFile ? `Source found: ${item.sourceFile}` : `Source not found locally: ${item.sourcePath || "unknown"}`)}</small>
            </div>
          `).join("")}
        </div>
      ` : "";
    }
    r2CoverageNote.textContent = coverage.ok
      ? basketCatalogPhotos
        ? "Active catalog coverage is satisfied; Waste Basket media is excluded from repair targets."
        : "Policy is satisfied for the current catalog."
      : "Missing coverage. Fix it runs the sweep below and keeps manifests in sync.";
    r2CoverageOk = coverage.ok;
    if (blockedPreviewCountRoot) blockedPreviewCountRoot.textContent = formatCount(blockedCloudMediaCountFromCoverage());
    if (latestR2ProgressTasks.length) renderWasteBasketProgress(latestR2ProgressTasks);
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
      if (wasteCleanupActive && Date.now() - lastWasteCoverageRefreshAt > 15000) {
        lastWasteCoverageRefreshAt = Date.now();
        loadR2Coverage().then(refreshBlockedSyncPanel).then(() => renderWasteBasketProgress(tasks)).catch(() => {});
      }
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
        await withTimeout(Promise.all([loadR2Coverage(), loadR2Progress()]), 12000, "Waste Basket refresh");
        await refreshBlockedSyncPanel();
        setStatus("Waste Basket cleanup refreshed.");
      } else if (kind === "coverage") {
        await withTimeout(loadR2Coverage(), 12000, "R2 coverage refresh");
        setStatus("R2 catalog coverage refreshed.");
      } else if (kind === "progress") {
        await withTimeout(loadR2Progress(), 12000, "R2 progress refresh");
        setStatus("R2 background work refreshed.");
      } else if (kind === "cost") {
        await withTimeout(loadCostEstimate(), 12000, "Cloud cost refresh");
        setStatus("Cloud bill forecast refreshed.");
      } else if (kind === "keyword-blacklist") {
        await loadKeywordBlacklist();
        setStatus("Keyword blacklist refreshed.");
      } else if (kind === "real-estate") {
        await loadRealEstateOwner();
        setStatus("Real estate clients refreshed.");
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
  renderCostEstimate();

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

  realEstateClientList?.addEventListener("click", (event) => {
    const rowAction = event.target.closest("[data-owner-re-row-action]");
    if (rowAction) {
      const clientId = rowAction.dataset.ownerReClientId || "";
      if (rowAction.dataset.ownerReRowAction === "delete") {
        deleteRealEstateClient(clientId);
        return;
      }
      selectedRealEstateClientId = clientId;
      renderRealEstateClients();
      const selected = selectedRealEstateClient();
      setRealEstateStatus(selected ? `${selected.customer} selected.` : "No real estate client selected.");
      return;
    }
    const row = event.target.closest("[data-owner-re-client]");
    if (!row) return;
    selectedRealEstateClientId = row.dataset.ownerReClient || "";
    renderRealEstateClients();
    const selected = selectedRealEstateClient();
    setRealEstateStatus(selected ? `${selected.customer} selected.` : "No real estate client selected.");
  });

  realEstateFields.customer?.addEventListener("input", (event) => {
    updateRealEstateComputed(event.target.value || "");
  });

  realEstateForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveRealEstateClient();
  });

  realEstateForm?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-owner-re-action]");
    if (!button) return;
    runRealEstateClientAction(button.dataset.ownerReAction || "");
  });

  wipeHiddenR2Button?.addEventListener("click", async () => {
    if (wasteDeleteActive) {
      setStatus("Waste Basket R2 purge is already running. Watch Cloud media left on the card.");
      return;
    }
    const ok = window.confirm("Purge R2 copies for every Waste Basket photo? This deletes public previews, private masters, and private render triplets. Ban/tombstone records stay, so these photos remain banned and do not return.");
    if (!ok) return;
    wipeHiddenR2Button.disabled = true;
    setStatus("Queueing banned-photo R2 purge...");
    try {
      const result = await hiddenActions.wipeHiddenR2?.();
      renderCounts();
      await refreshDiscardedCount();
      await loadR2Coverage();
      await refreshBlockedSyncPanel();
      if (result?.r2_delete_task) renderR2Progress([result.r2_delete_task]);
      loadR2Progress();
      setStatus(`R2 purge queued: ${formatCount(result?.moved_to_tombstones_count || 0)} live bans moved to permanent tombstones, ${formatCount(result?.discarded_count || 0)} total tombstones.`);
    } catch (error) {
      setStatus(error?.message || "Could not queue banned-photo R2 purge.");
    } finally {
      if (!wasteDeleteActive) wipeHiddenR2Button.disabled = false;
    }
  });

  r2FixButton?.addEventListener("click", async () => {
    const authorized = await ownerAuth?.requireAuth?.("Start the local Photos By Elie server to repair R2 coverage.");
    if (ownerAuth?.enabled && !authorized) return;
    const ok = window.confirm("Run the full lock-guarded cloud media sweep now? This may upload/render missing objects, delete R2 objects for banned photos while keeping their ban records, validate, commit, and push manifest changes.");
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
    loadCostEstimate();
    loadKeywordBlacklist();
    loadRealEstateOwner();
    startR2Polling();
  }
})();
