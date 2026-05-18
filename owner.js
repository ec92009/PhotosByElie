(async () => {
  const ownerTabButtons = [...document.querySelectorAll("[data-owner-tab-button]")];
  const ownerTabCards = [...document.querySelectorAll("[data-owner-tab]")];
  const OWNER_TAB_STORAGE_KEY = "photosbyelie-owner-tab";

  const ownerTabExists = (tab) => ownerTabButtons.some((button) => button.dataset.ownerTabButton === tab);

  const storedOwnerTab = () => {
    try {
      const tab = localStorage.getItem(OWNER_TAB_STORAGE_KEY) || "";
      return ownerTabExists(tab) ? tab : "";
    } catch {
      return "";
    }
  };

  const ownerTabFromLocation = () => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab") || params.get("ownerTab") || window.location.hash.replace(/^#/, "");
    return ownerTabExists(tab) ? tab : "";
  };

  const setOwnerTab = (tab, options = {}) => {
    if (!ownerTabButtons.length || !ownerTabCards.length) return;
    const next = ownerTabExists(tab) ? tab : ownerTabButtons[0].dataset.ownerTabButton;
    ownerTabButtons.forEach((button) => {
      const active = button.dataset.ownerTabButton === next;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    ownerTabCards.forEach((card) => {
      if (card.dataset.ownerTab === next) {
        delete card.dataset.ownerTabHidden;
      } else {
        card.dataset.ownerTabHidden = "true";
      }
    });
    if (options.persist !== false) {
      try {
        localStorage.setItem(OWNER_TAB_STORAGE_KEY, next);
      } catch {
        // Local storage can be unavailable in embedded previews.
      }
    }
  };

  setOwnerTab(ownerTabFromLocation() || storedOwnerTab(), { persist: false });

  ownerTabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setOwnerTab(button.dataset.ownerTabButton || "");
    });
  });

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
  const r2FillGapsButtons = [...document.querySelectorAll("[data-owner-r2-fill-gaps]")];
  const r2Card = document.querySelector("[data-owner-r2-card]");
  const r2Summary = document.querySelector("[data-owner-r2-summary]");
  const r2Phases = document.querySelector("[data-owner-r2-phases]");
  const r2Counts = document.querySelector("[data-owner-r2-counts]");
  const expandedSweepPhaseKeys = new Set();
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
  const realEstateComputed = Object.fromEntries(
    [...document.querySelectorAll("[data-owner-re-computed]")]
      .map((field) => [field.dataset.ownerReComputed, field])
  );
  const refreshButtons = [...document.querySelectorAll("[data-owner-refresh]")];
  const productSettings = window.photosByElieProductSettings;
  let r2PollTimer = null;
  let r2RepairLogToken = "";
  let r2RepairActive = false;
  let r2GapFillActive = false;
  let r2CoverageOk = false;
  let r2RepairLogSummary = null;
  let r2RepairLogTaskId = "";
  let r2PhaseRenderSnapshot = null;
  let wasteDeleteActive = false;
  let wasteCleanupActive = false;
  let lastWasteCoverageRefreshAt = 0;
  let lastImportCoverageRefreshAt = 0;
  let latestR2ProgressTasks = [];
  let currentCostEstimate = null;
  let keywordBlacklistTerms = [];
  let realEstateClients = [];
  let selectedRealEstateClientId = "";
  let realEstateBusy = false;
  let realEstateProgressTimer = null;
  let realEstateDraftSerial = 0;

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

  const PHOTO_IMPORT_PHASES = new Map([
    ["camera", "Camera"],
    ["apple-photo-albums", "Apple Photos"],
    ["leonardo", "AI"],
    ["real-estate", "RE"],
  ]);
  const IMPORT_DASHBOARD_PHASE_KEYS = ["camera", "apple-photo-albums", "leonardo", "real-estate"];
  const IMPORT_MATRIX_STEPS = [
    ["master_uploaded", "Master"],
    ["triplets_created", "Triplets made"],
    ["triplets_uploaded", "Triplets up"],
    ["previews_created", "Previews made"],
    ["previews_uploaded", "Previews up"],
  ];
  const IMPORT_MATRIX_QUEUE_PREVIEW_LIMIT = 5;
  const IMPORT_MATRIX_RECENT_DONE_LIMIT = 1;
  const SWEEP_PHASES = [
    ["prepare", "Prepare workspace"],
    ["gap-fill", "Fill in coverage gaps"],
    ["discard-start", "Double-check banned R2 cleanup"],
    ["camera", "Import Camera sources"],
    ["apple-photo-albums", "Import Apple Photos"],
    ["leonardo", "Import AI sources"],
    ["real-estate", "Import RE sources", { optional: true }],
    ["catalog", "Export catalog"],
    ["worker", "Write worker catalog"],
    ["sidecar", "Write media sidecar"],
    ["private", "Backfill Lost Triplets"],
    ["discard-final", "Final banned R2 cleanup double-check"],
    ["storage", "Refresh storage estimate"],
    ["test", "Run tests"],
    ["validate", "Validate publish"],
    ["commit", "Commit and push"],
    ["coverage", "Recheck coverage"],
  ].map(([key, label, options]) => ({ key, label, ...(options || {}) }));
  const SWEEP_SKIPPABLE_KEYS = new Set([
    "discard-start",
    "camera",
    "apple-photo-albums",
    "leonardo",
    "real-estate",
    "private",
    "discard-final",
    "test",
    "validate",
  ]);

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
  const secondsSinceIso = (value) => {
    const timestamp = Date.parse(value || "");
    if (!Number.isFinite(timestamp)) return 0;
    return Math.max(0, (Date.now() - timestamp) / 1000);
  };
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

  const parseRealEstateProperties = (value) => String(value || "")
    .split(/\r?\n|,/)
    .map((property) => property.trim())
    .filter(Boolean);

  const realEstateRowByClientId = (clientId) => (
    [...(realEstateClientList?.querySelectorAll("[data-owner-re-client]") || [])]
      .find((row) => row.dataset.ownerReClient === clientId) || null
  );

  const focusRealEstateClientField = (clientId, field = "customer") => {
    window.requestAnimationFrame(() => {
      const row = realEstateRowByClientId(clientId);
      const control = row?.querySelector(`[data-owner-re-inline-field="${field}"]`);
      control?.focus();
      if (typeof control?.select === "function" && control.tagName !== "TEXTAREA") control.select();
    });
  };

  const markRealEstateRowSelected = (clientId) => {
    selectedRealEstateClientId = clientId || "";
    realEstateClientList?.querySelectorAll("[data-owner-re-client]").forEach((row) => {
      row.classList.toggle("is-active", row.dataset.ownerReClient === selectedRealEstateClientId);
    });
    const selected = selectedRealEstateClient();
    updateRealEstateComputed(selected || blankRealEstateClient());
    updateRealEstateLinks(selected && !selected.isDraft ? selected : null);
    return selected;
  };

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
    updateRealEstateComputed(client);
    updateRealEstateLinks(client && !client.isDraft ? client : null);
  };

  const realEstateCellInput = (client, field, value, options = {}) => {
    const attrs = [
      `class="owner-real-estate-cell-input"`,
      `type="${escapeHtml(options.type || "text")}"`,
      `value="${escapeHtml(value)}"`,
      `data-owner-re-inline-field="${escapeHtml(field)}"`,
      `data-owner-re-client-id="${escapeHtml(client.id || "")}"`,
      `autocomplete="${escapeHtml(options.autocomplete || "off")}"`,
    ];
    if (options.required) attrs.push("required");
    if (options.placeholder) attrs.push(`placeholder="${escapeHtml(options.placeholder)}"`);
    if (options.min) attrs.push(`min="${escapeHtml(options.min)}"`);
    if (options.step) attrs.push(`step="${escapeHtml(options.step)}"`);
    if (options.inputmode) attrs.push(`inputmode="${escapeHtml(options.inputmode)}"`);
    return `<input ${attrs.join(" ")}/>`;
  };

  const realEstatePropertiesCell = (client, properties) => `
    <textarea class="owner-real-estate-cell-input owner-real-estate-cell-properties" rows="2"
      data-owner-re-inline-field="properties"
      data-owner-re-client-id="${escapeHtml(client.id || "")}"
      placeholder="Property folders">${escapeHtml(properties.join("\n"))}</textarea>
  `;

  const realEstateRowIcon = (name) => {
    if (name === "trash") {
      return `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/></svg>`;
    }
    return `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>`;
  };

  const renderRealEstateClients = () => {
    if (!realEstateCard) return;
    const selected = selectedRealEstateClient();
    const savedClients = realEstateClients.filter((client) => !client.isDraft);
    if (realEstateClientCountRoot) realEstateClientCountRoot.textContent = formatCount(savedClients.length);
    if (realEstatePhotoCountRoot) {
      realEstatePhotoCountRoot.textContent = formatCount(savedClients.reduce((sum, client) => sum + Number(client.stats?.photoCount || 0), 0));
    }
    if (realEstateAlbumCountRoot) {
      realEstateAlbumCountRoot.textContent = formatCount(savedClients.reduce((sum, client) => sum + Math.max(
        Number(client.stats?.albumCount || 0),
        realEstatePropertiesFor(client).length
      ), 0));
    }
    if (realEstateClientList) {
      realEstateClientList.innerHTML = realEstateClients.length ? realEstateClients.map((client) => {
        const active = client.id === selected?.id;
        const properties = realEstatePropertiesFor(client);
        const missingProperties = client.missingProperties || [];
        const statusBits = client.isDraft
          ? ["draft", "not saved"]
          : [
              missingProperties.length
                ? `skipping: ${missingProperties.join(", ")}`
                : (client.sourceRootExists ? "source ok" : "source missing"),
              client.publicContextExists ? "published" : "not published",
            ];
        const rowLabel = client.customer || client.id || "new client";
        return `
          <tr class="${active ? "is-active" : ""}" data-owner-re-client="${escapeHtml(client.id)}">
            <td>${realEstateCellInput(client, "customer", client.customer || "", { required: true, placeholder: "Client" })}</td>
            <td>${realEstateCellInput(client, "email", client.email || "", { type: "email", placeholder: "email@example.com" })}</td>
            <td>${realEstateCellInput(client, "accessCode", client.accessCode || "", { required: true, placeholder: "Password" })}</td>
            <td>${realEstateCellInput(client, "maxItems", client.maxItems || 300, { type: "number", min: "1", step: "1", inputmode: "numeric" })}</td>
            <td>${realEstatePropertiesCell(client, properties)}</td>
            <td>${escapeHtml(formatCount(client.stats?.photoCount || 0))}</td>
            <td>${escapeHtml(statusBits.join(" / "))}</td>
            <td>
              <div class="owner-real-estate-row-actions">
                <button class="owner-real-estate-icon-button" type="button" data-owner-re-row-action="edit" data-owner-re-client-id="${escapeHtml(client.id)}" aria-label="Edit ${escapeHtml(rowLabel)}" title="Edit client">${realEstateRowIcon("pen")}</button>
                <button class="owner-real-estate-icon-button is-danger" type="button" data-owner-re-row-action="delete" data-owner-re-client-id="${escapeHtml(client.id)}" aria-label="Delete ${escapeHtml(rowLabel)}" title="Delete client">${realEstateRowIcon("trash")}</button>
              </div>
            </td>
          </tr>
        `;
      }).join("") : `<tr><td colspan="8">No real estate clients yet. Use New client to add one.</td></tr>`;
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

  const realEstateClientPayload = (client) => ({
    id: client?.isDraft ? "" : (client?.id || ""),
    customer: client?.customer || "",
    email: client?.email || "",
    accessCode: client?.accessCode || "",
    properties: realEstatePropertiesFor(client).join("\n"),
    maxItems: client?.maxItems || 300,
  });

  const updateRealEstateClientFromControl = (control) => {
    const clientId = control?.dataset?.ownerReClientId || control?.closest("[data-owner-re-client]")?.dataset.ownerReClient || "";
    const field = control?.dataset?.ownerReInlineField || "";
    const client = realEstateClients.find((item) => item.id === clientId);
    if (!client || !field) return null;
    if (field === "properties") {
      client.properties = parseRealEstateProperties(control.value || "");
      client.effectiveProperties = client.properties;
    } else if (field === "maxItems") {
      const maxItems = Math.max(1, Math.round(Number(control.value || 300)));
      client.maxItems = Number.isFinite(maxItems) ? maxItems : 300;
      control.value = String(client.maxItems);
    } else {
      client[field] = control.value || "";
    }
    markRealEstateRowSelected(client.id);
    return client;
  };

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
    const sourceRoot = `/Volumes/Saturn/Pictures/RE/${clientName}`;
    if (total > 0) {
      return `Real Estate import from ${sourceRoot}: ${formatCount(completed)} / ${formatCount(total)} media${currentAlbum}.${skippedText}`;
    }
    return `Real Estate import from ${sourceRoot}: scanning available media.${skippedText}`;
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

  const saveRealEstateInlineClient = async (clientId) => {
    const client = realEstateClients.find((item) => item.id === clientId);
    if (!client) return;
    const clientName = String(client.customer || "").trim();
    const password = String(client.accessCode || "").trim();
    if (!clientName) {
      setRealEstateStatus("Client name is required before autosave.");
      return;
    }
    if (!password) {
      setRealEstateStatus(`${clientName}: enter a password to save this client.`);
      return;
    }
    setRealEstateStatus(`Saving ${clientName}...`);
    try {
      const payload = await postRealEstateOwnerAction({
        action: "save-client",
        client: realEstateClientPayload(client),
      });
      realEstateClients = Array.isArray(payload.clients) ? payload.clients : realEstateClients;
      selectedRealEstateClientId = payload.client?.id || selectedRealEstateClientId;
      renderRealEstateClients();
      renderRealEstateOutput("");
      setRealEstateStatus(`${payload.client?.customer || clientName} saved.`);
    } catch (error) {
      setRealEstateStatus(error?.message || "Could not save real estate client.");
    }
  };

  const startNewRealEstateClient = () => {
    const existingDraft = realEstateClients.find((client) => client.isDraft);
    if (existingDraft) {
      selectedRealEstateClientId = existingDraft.id;
      renderRealEstateClients();
      focusRealEstateClientField(existingDraft.id, "customer");
      setRealEstateStatus("Finish the draft client. It saves automatically after client and password are filled.");
      return;
    }
    realEstateDraftSerial += 1;
    const draft = {
      ...blankRealEstateClient(),
      id: `__draft-real-estate-${Date.now()}-${realEstateDraftSerial}`,
      isDraft: true,
    };
    realEstateClients = [draft, ...realEstateClients];
    selectedRealEstateClientId = draft.id;
    renderRealEstateClients();
    renderRealEstateOutput("");
    focusRealEstateClientField(draft.id, "customer");
    setRealEstateStatus("New client draft. Fill client and password; each field saves when you leave it.");
  };

  const deleteRealEstateClient = async (clientId = selectedRealEstateClientId) => {
    const client = realEstateClients.find((item) => item.id === clientId);
    if (!client) {
      setRealEstateStatus("Select a real estate client to delete.");
      return;
    }
    if (client.isDraft) {
      realEstateClients = realEstateClients.filter((item) => item.id !== client.id);
      selectedRealEstateClientId = realEstateClients[0]?.id || "";
      renderRealEstateClients();
      renderRealEstateOutput("");
      setRealEstateStatus("Draft client discarded.");
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
      setRealEstateStatus("Select a real estate client first.");
      return;
    }
    if (selected.isDraft) {
      setRealEstateStatus("Finish the draft client before running imports, publishing, or uploads.");
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

  const r2GapPhotoCount = () => (
    Array.isArray(window.photosByElieR2Coverage?.missingImportPhotos)
      ? window.photosByElieR2Coverage.missingImportPhotos.length
      : 0
  );

  const r2GapCounts = () => {
    const photos = Array.isArray(window.photosByElieR2Coverage?.missingImportPhotos)
      ? window.photosByElieR2Coverage.missingImportPhotos
      : [];
    return {
      photos: photos.length,
      masters: photos.filter((photo) => photo.steps?.master_uploaded?.status === "pending").length,
      triplets: photos.filter((photo) => photo.steps?.triplets_uploaded?.status === "pending").length,
      previews: photos.filter((photo) => photo.steps?.previews_uploaded?.status === "pending").length,
    };
  };

  const r2GapStatusText = () => {
    if (!window.photosByElieR2Coverage) return "Coverage is still loading.";
    if (r2CoverageOk) return "Imports are up to date: no active catalog media gaps are listed.";
    const gaps = r2GapCounts();
    if (gaps.photos) {
      return `${formatCount(gaps.photos)} incomplete photos: ${formatCount(gaps.masters)} need masters, ${formatCount(gaps.triplets)} need private JPG triplets, ${formatCount(gaps.previews)} need public previews.`;
    }
    const missing = coverageRepairGapSummary();
    return missing ? `Coverage still has gaps: ${missing}.` : "Coverage still has gaps.";
  };

  const syncR2ActionButtons = () => {
    const busy = r2RepairActive || r2GapFillActive;
    if (r2FixButton) {
      r2FixButton.disabled = r2CoverageOk || busy;
      r2FixButton.textContent = busy ? "Background work running" : "Start background work";
    }
    const gapCount = r2GapPhotoCount();
    r2FillGapsButtons.forEach((button) => {
      button.disabled = r2CoverageOk || busy || gapCount === 0;
      button.textContent = r2GapFillActive ? "Filling gaps..." : "Fill in gaps";
      button.title = gapCount
        ? `Render and upload missing media for ${formatCount(gapCount)} incomplete photos`
        : "No incomplete upload photos are listed";
    });
    if (r2CoverageNote && r2RepairActive) {
      setText(r2CoverageNote, "Background work is running. Banned photos stay banned; this only removes their old R2 objects.");
    }
  };

  const summarizeR2RepairLog = (text = "") => {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const latest = lines.at(-1) || "";
    const lastMatch = (pattern) => {
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const match = lines[index].match(pattern);
        if (match) return { line: lines[index], match, index };
      }
      return null;
    };
    const lastMatchAfter = (pattern, startIndex) => {
      for (let index = lines.length - 1; index >= Math.max(0, startIndex); index -= 1) {
        const match = lines[index].match(pattern);
        if (match) return { line: lines[index], match, index };
      }
      return null;
    };
    const parsePayloadMatch = (row) => {
      if (!row?.match?.[1]) return null;
      try {
        return JSON.parse(row.match[1]);
      } catch {
        return null;
      }
    };
    const parsePayloadText = (value) => {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    };
    const deleted = lastMatch(/^Done\. (?:Would check|Checked) ([0-9,]+) public and ([0-9,]+) private banned-photo R2 key checks for ([0-9,]+) discarded photos(?:; ([0-9,]+) already trusted from Owner DB)?\./)
      || lastMatch(/^Done\. (?:Would delete|Deleted) ([0-9,]+) public and ([0-9,]+) private object references for ([0-9,]+) discarded photos\./);
    const deleteStart = lastMatch(/^DELETE_START\s+([0-9,]+)\s+([0-9,]+)\s+([0-9,]+)\s+([0-9,]+)/);
    const deleteProgress = lastMatch(/^DELETE_PROGRESS\s+([0-9,]+)\s+([0-9,]+)\s+([0-9,]+)\s+([0-9,]+)\s+([0-9,]+)/);
    const deleteContext = lastMatch(/^DELETE_CONTEXT\s+({.+})$/);
    const deleteContextPayload = parsePayloadMatch(deleteContext);
    const phaseMarker = lastMatch(/^SWEEP_PHASE\s+(\S+)\s+(.+)/);
    const importPhaseKey = phaseMarker?.match?.[1] || "";
    const scopedImport = PHOTO_IMPORT_PHASES.has(importPhaseKey);
    const importStartIndex = scopedImport ? phaseMarker.index + 1 : 0;
    const scanPattern = /^(?:Processing (?:final )?batch after scanning|Scanned) ([0-9,]+) files[;,] inspected ([0-9,]+), selected ([0-9,]+)/;
    const startedPattern = /^START\s+([0-9,]+):\s+(\S+)\s+(\S+)\s+(.+)/;
    const importedPattern = /^([0-9,]+):\s+(\S+)\s+rendered\s+(\S+)\s+public\s+([0-9,]+)\s+private-renders\s+([0-9,]+)/;
    const scan = scopedImport ? lastMatchAfter(scanPattern, importStartIndex) : (phaseMarker ? null : lastMatch(scanPattern));
    const started = scopedImport ? lastMatchAfter(startedPattern, importStartIndex) : (phaseMarker ? null : lastMatch(startedPattern));
    const imported = scopedImport ? lastMatchAfter(importedPattern, importStartIndex) : (phaseMarker ? null : lastMatch(importedPattern));
    const realEstateClient = scopedImport ? lastMatchAfter(/^PBE_RE_CLIENT_START\s+({.+})$/, importStartIndex) : null;
    const realEstateImport = scopedImport ? lastMatchAfter(/^PBE_IMPORT_PROGRESS\s+({.+})$/, importStartIndex) : null;
    const realEstateUploadStart = scopedImport ? lastMatchAfter(/^PBE_RE_UPLOAD_START\s+({.+})$/, importStartIndex) : null;
    const realEstateUpload = scopedImport ? lastMatchAfter(/^PBE_RE_UPLOAD_PROGRESS\s+({.+})$/, importStartIndex) : null;
    const realEstateDone = lastMatch(/^PBE_RE_DONE\s+({.+})$/);
    const realEstateClientPayload = parsePayloadMatch(realEstateClient);
    const realEstateImportPayload = parsePayloadMatch(realEstateImport);
    const realEstateUploadStartPayload = parsePayloadMatch(realEstateUploadStart);
    const realEstateUploadPayload = parsePayloadMatch(realEstateUpload);
    const realEstateDonePayload = parsePayloadMatch(realEstateDone);
    const importScanProgress = scopedImport ? lastMatchAfter(/^PBE_IMPORT_SCAN_PROGRESS\s+({.+})$/, importStartIndex) : null;
    const importScanDone = scopedImport ? lastMatchAfter(/^PBE_IMPORT_SCAN_DONE\s+({.+})$/, importStartIndex) : null;
    const importQueueStart = scopedImport ? lastMatchAfter(/^PBE_IMPORT_QUEUE_START\s+({.*})$/, importStartIndex) : null;
    const importQueueProgress = scopedImport ? lastMatchAfter(/^PBE_IMPORT_QUEUE_PROGRESS\s+({.+})$/, importStartIndex) : null;
    const importScanProgressPayload = parsePayloadMatch(importScanProgress);
    const importScanDonePayload = parsePayloadMatch(importScanDone);
    const importQueueStartPayload = parsePayloadMatch(importQueueStart);
    const importQueueProgressPayload = parsePayloadMatch(importQueueProgress);
    const importPlan = lastMatch(/^PBE_IMPORT_PLAN\s+({.+})$/);
    const importDone = lastMatch(/^PBE_IMPORT_DONE\s+({.+})$/);
    const importPlanPayload = parsePayloadMatch(importPlan);
    const importDonePayload = parsePayloadMatch(importDone);
    const upload = lastMatch(/^([0-9,]+):\s+(\S+)\s+(?:uploaded|would upload)\s+([0-9,]+)/);
    const processed = lastMatch(/^Done\. Processed ([0-9,]+) photos?\./);
    const manifest = lastMatch(/^Refreshed .*?: ([0-9,]+) complete private render triplets\./);
    const rawError = lastMatch(/^(ERROR\b|.*\berror: ).*/i);
    const importPhotoRows = [];
    const importPhotoMap = new Map();
    const ensureImportPhoto = (payload = {}) => {
      const id = String(payload.photoId || payload.id || payload.relativePath || "").trim();
      if (!id) return null;
      if (!importPhotoMap.has(id)) {
        const row = {
          id,
          index: importPhotoRows.length + 1,
          relativePath: "",
          country: "",
          mediaType: "",
          status: "running",
          steps: {},
        };
        importPhotoMap.set(id, row);
        importPhotoRows.push(row);
      }
      const row = importPhotoMap.get(id);
      if (payload.eventIndex !== undefined) row.lastEventIndex = Number(payload.eventIndex) || row.lastEventIndex || 0;
      if (payload.index) row.index = Number(payload.index) || row.index;
      if (payload.relativePath) row.relativePath = String(payload.relativePath);
      if (payload.country) row.country = String(payload.country);
      if (payload.mediaType) row.mediaType = String(payload.mediaType);
      if (payload.status) {
        row.status = String(payload.status);
        if (row.status === "done") row.doneEventIndex = row.lastEventIndex || row.doneEventIndex || 0;
      }
      return row;
    };
    const importEventStart = scopedImport ? importStartIndex : 0;
    for (let index = importEventStart; index < lines.length; index += 1) {
      const event = lines[index].match(/^PBE_IMPORT_(PHOTO|STEP|PHOTO_DONE)\s+({.+})$/);
      if (!event) continue;
      const payload = parsePayloadText(event[2]);
      if (!payload) continue;
      const row = ensureImportPhoto(payload);
      if (!row) continue;
      row.lastEventIndex = index;
      if (event[1] === "STEP") {
        const step = String(payload.step || "");
        if (step) {
          row.steps[step] = {
            status: String(payload.status || "done"),
            completed: Number(payload.completed || 0),
            total: Number(payload.total || 0),
            reason: String(payload.reason || ""),
          };
        }
      }
      if (event[1] === "PHOTO_DONE") {
        row.status = String(payload.status || "done");
        row.doneEventIndex = index;
      }
    }
    const doneKeys = new Set(lines
      .map((line) => line.match(/^SWEEP_DONE\s+(\S+)/)?.[1])
      .filter(Boolean));
    const skippedKeys = new Set(lines
      .map((line) => line.match(/^SWEEP_SKIP\s+(\S+)/)?.[1])
      .filter(Boolean));
    const skipTerminatedError = rawError && skippedKeys.size && /\bSIGTERM\b|Signals\.SIGTERM/i.test(rawError.line);
    const error = skipTerminatedError ? null : rawError;
    let phase = "Starting cloud media sweep";
    if (deleteProgress || deleteStart) phase = "Double-checking banned-photo R2 cleanup";
    if (deleted) phase = "Banned-photo R2 cleanup double-check finished";
    if (scan) phase = "Scanning and importing Saturn sources";
    if (started) phase = "Rendering and uploading selected photo";
    if (imported) phase = "Rendering and uploading selected previews";
    if (realEstateImportPayload) phase = "Importing Real Estate sources";
    if (realEstateUploadStartPayload || realEstateUploadPayload) phase = "Uploading Real Estate media";
    if (realEstateDonePayload) phase = "Real Estate sync finished";
    if (importPlanPayload && importPhaseKey === "gap-fill") phase = "Filling upload coverage gaps";
    if (importDonePayload && importPhaseKey === "gap-fill") phase = "Upload gap fill finished";
    if (upload) phase = "Creating and uploading missing private JPGs";
    if (processed) phase = "Private JPG backfill pass finished";
    if (manifest) phase = "Refreshing private delivery manifest";
    if (phaseMarker) phase = phaseMarker.match[2];
    if (error) phase = "Needs attention";
    let phaseKey = phaseMarker?.match?.[1] || "";
    if (!phaseKey) {
      if (upload || processed || manifest) phaseKey = "private";
      else if (importPlanPayload || importDonePayload) phaseKey = "gap-fill";
      else if (realEstateImportPayload || realEstateUploadStartPayload || realEstateUploadPayload || realEstateDonePayload) phaseKey = "real-estate";
      else if (scan || started || imported) phaseKey = "camera";
      else if (deleted || deleteProgress || deleteStart) phaseKey = "discard-start";
      else phaseKey = "prepare";
    }
    return {
      latest,
      phase,
      phaseKey,
      doneKeys,
      skippedKeys,
      deleted,
      deleteStart,
      deleteProgress,
      deleteContext,
      deleteContextPayload,
      scan,
      started,
      imported,
      realEstateClient,
      realEstateClientPayload,
      realEstateImport,
      realEstateImportPayload,
      realEstateUploadStart,
      realEstateUploadStartPayload,
      realEstateUpload,
      realEstateUploadPayload,
      realEstateDone,
      realEstateDonePayload,
      importScanProgress,
      importScanProgressPayload,
      importScanDone,
      importScanDonePayload,
      importQueueStart,
      importQueueStartPayload,
      importQueueProgress,
      importQueueProgressPayload,
      importPlan,
      importPlanPayload,
      importDone,
      importDonePayload,
      importPhotoRows,
      upload,
      processed,
      manifest,
      error,
    };
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

  const coverageRepairGapSummary = () => {
    const rows = Array.isArray(window.photosByElieR2Coverage?.rows)
      ? window.photosByElieR2Coverage.rows
      : [];
    const missingFor = (matcher) => rows
      .filter((row) => matcher(String(row.label || "").toLowerCase(), String(row.objectClass || "").toLowerCase()))
      .map((row) => Number(row.missing || 0))
      .filter((missing) => missing > 0);
    const maxMissing = (values) => values.length ? Math.max(...values) : 0;
    const publicPreviewPhotos = maxMissing(missingFor((label, objectClass) => label.includes("preview") || objectClass.includes("expo/")));
    const privateMasters = maxMissing(missingFor((label, objectClass) => label.includes("private masters") || objectClass === "masters"));
    const privateJpgSets = maxMissing(missingFor((label, objectClass) => label.includes("private jpg") || objectClass.startsWith("renders/")));
    const parts = [
      publicPreviewPhotos ? `${formatCount(publicPreviewPhotos)} public preview photos` : "",
      privateMasters ? `${formatCount(privateMasters)} private masters` : "",
      privateJpgSets ? `${formatCount(privateJpgSets)} private JPG sets` : "",
    ].filter(Boolean);
    return parts.join(", ");
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
    const ownerDbConfirmed = Number(logSummary?.deleteContextPayload?.ownerDbDeletedConfirmed || 0);
    const detail = total
      ? `Double-checking cleanup: ${formatCount(completed)} / ${formatCount(total)} R2 key checks, ${countdown}. Already purged; this pass only verifies leftovers are gone.`
      : ownerDbConfirmed
        ? `Owner DB already confirms ${formatCount(ownerDbConfirmed)} banned-photo R2 keys cleaned; no live checks needed.`
        : "Finding historical banned-photo R2 keys to double-check";
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
      ownerDbConfirmed,
    };
  };

  const cameraImportProgress = (logSummary, task = null) => {
    const rows = Array.isArray(logSummary?.importPhotoRows) ? logSummary.importPhotoRows : [];
    const finishedRows = rows.filter((row) => row.status === "done" || row.status === "error").length;
    const runningRow = rows.find((row) => row.status !== "done" && row.status !== "error") || null;
    const scanPayload = logSummary?.importScanDonePayload || logSummary?.importScanProgressPayload || {};
    const queuePayload = logSummary?.importQueueProgressPayload || logSummary?.importQueueStartPayload || {};
    const hasQueueEvents = Boolean(
      logSummary?.importScanProgressPayload
      || logSummary?.importScanDonePayload
      || logSummary?.importQueueStartPayload
      || logSummary?.importQueueProgressPayload
    );
    const selectedFromScan = numberFromLog(logSummary?.scan?.match?.[3]);
    const queued = Number(scanPayload.queued ?? queuePayload.queued ?? 0);
    const processed = Number(queuePayload.processed ?? scanPayload.processed ?? 0);
    const activeItemCount = Number(queuePayload.active ?? scanPayload.active ?? (runningRow ? 1 : 0));
    const queueDepth = Number(queuePayload.queueDepth ?? scanPayload.queueDepth ?? Math.max(0, queued - processed - activeItemCount));
    const planQueueDepth = Number(queuePayload.planQueueDepth ?? scanPayload.planQueueDepth ?? 0);
    const plannerActive = Number(queuePayload.plannerActive ?? scanPayload.plannerActive ?? 0);
    const alreadySelected = Number(scanPayload.alreadySelected ?? queuePayload.alreadySelected ?? 0);
    const scannedFiles = Number(scanPayload.seen ?? queuePayload.seen ?? numberFromLog(logSummary?.scan?.match?.[1]) ?? 0);
    const inspectedFiles = Number(scanPayload.inspected ?? queuePayload.inspected ?? numberFromLog(logSummary?.scan?.match?.[2]) ?? 0);
    const scanDone = Boolean(logSummary?.importScanDonePayload);
    const selected = Math.max(queued, processed + queueDepth + activeItemCount, selectedFromScan, rows.length);
    const completed = Math.max(rows.length ? finishedRows : 0, processed, numberFromLog(logSummary?.imported?.match?.[1]));
    const startedIndex = rows.length
      ? completed + (runningRow ? 1 : 0)
      : numberFromLog(logSummary?.started?.match?.[1]);
    const current = Math.max(completed + (activeItemCount ? 1 : 0), startedIndex);
    const active = task?.state === "queued" || task?.state === "running";
    const scanningForMore = Boolean(active && (hasQueueEvents ? !scanDone : selected && completed >= selected));
    const scanDraining = Boolean(active && scanDone && queueDepth > 0);
    const elapsedSeconds = secondsSinceIso(task?.started_at || task?.queued_at || "");
    const secondsLeft = completed >= 5 && selected > completed && elapsedSeconds > 0
      ? ((selected - completed) / completed) * elapsedSeconds
      : 0;
    const countdown = scanningForMore
      ? (secondsLeft ? `${formatDuration(secondsLeft)} for the current queue` : "Scanner is still building the queue")
      : secondsLeft
      ? formatDuration(secondsLeft)
      : (selected && completed >= selected ? "0s" : "Estimating");
    const percent = selected
      ? Math.max(current ? 1 : 0, Math.min(scanningForMore ? 96 : current >= selected ? 100 : 96, Math.round((current / selected) * 100)))
      : (scanningForMore ? 18 : 25);
    const photo = runningRow?.id || logSummary?.started?.match?.[2] || logSummary?.imported?.match?.[2] || "";
    const remaining = Math.max(0, selected - completed);
    return {
      selected,
      selectedFromScan,
      found: rows.length,
      queued,
      queueDepth,
      planQueueDepth,
      plannerActive,
      alreadySelected,
      scannedFiles,
      inspectedFiles,
      completed,
      processed,
      activeItemCount,
      current,
      startedIndex,
      remaining,
      percent,
      countdown,
      photo,
      scanningForMore,
      scanDone,
      scanDraining,
    };
  };

  const importSourceLabel = (phaseKey) => PHOTO_IMPORT_PHASES.get(phaseKey) || "Camera";

  const sourceLaneAction = (phaseKey) => (
    phaseKey === "real-estate"
      ? "Checks configured client property folders, rebuilds public review context, and uploads expected RE preview/master keys."
      : "Pipeline: scanner finds source files, planner checks metadata and trusted R2 coverage, worker only creates/uploads missing boxes."
  );

  const sourceLaneDetailRows = (phaseKey, details = {}) => {
    const rows = [["Source lane", importSourceLabel(phaseKey)]];
    const add = (label, value) => {
      const text = Array.isArray(value)
        ? value.map((item) => String(item || "").trim()).filter(Boolean).join(" ")
        : String(value || "").trim();
      if (text) rows.push([label, text]);
    };
    add("Source group", details.sourceGroup);
    add("Current file", details.currentFile);
    add("Current photo", details.currentPhoto);
    add("Scanner", details.scanner);
    add("Planner", details.planner);
    add("Queue", details.queue);
    add("Progress bar counts", details.progressCounts);
    add("Coverage gaps", details.coverageGaps);
    add("Progress summary", details.progressSummary);
    add("Finished this run", details.finishedSummary);
    add("Upload progress", details.uploadProgress);
    add("Time left estimate", details.timeLeft);
    add("Notes", details.notes);
    add("What happens", details.whatHappens || sourceLaneAction(phaseKey));
    return rows;
  };

  const cameraImportProgressDetail = (progress, phaseKey = "camera") => {
    const sourceLabel = importSourceLabel(phaseKey);
    const gapSummary = coverageRepairGapSummary();
    if (!progress.selected) {
      const inspected = progress.inspectedFiles ? ` ${formatCount(progress.inspectedFiles)} source files inspected so far.` : "";
      return `${sourceLabel} scanner is filling the import queue; processing starts as soon as a needed photo is found.${inspected}`;
    }
    const selected = formatCount(progress.selected);
    const completed = formatCount(progress.completed);
    const remaining = formatCount(progress.remaining);
    const current = formatCount(Math.min(Math.max(progress.current, progress.completed), progress.selected));
    const timeLeft = progress.countdown === "Estimating"
      ? "time left estimate starts after a few renders complete"
      : progress.scanningForMore
      ? progress.countdown
      : `rough time left ${progress.countdown}`;
    if (progress.scanningForMore) {
      const inspected = progress.inspectedFiles ? ` ${formatCount(progress.inspectedFiles)} source files inspected so far.` : "";
      const queue = `${formatCount(progress.queueDepth)} waiting to render/upload`;
      const planner = progress.plannerActive || progress.planQueueDepth
        ? ` Planner has ${formatCount(progress.planQueueDepth)} scan batches waiting.`
        : "";
      return `${sourceLabel} queue: ${completed} / ${selected} photos processed, ${queue}; scanner is still adding any newly discovered work.${inspected}${planner}`;
    }
    if (progress.scanDraining) {
      return `${sourceLabel} scan is complete; draining the queue oldest-first: ${completed} / ${selected} photos processed, ${formatCount(progress.queueDepth)} waiting; ${timeLeft}.`;
    }
    if (progress.completed >= progress.selected) {
      return `${sourceLabel} queue finished: ${completed} / ${selected} photos processed for the current expected R2 keys; ${timeLeft}.`;
    }
    if (progress.startedIndex > progress.completed) {
      return `${sourceLabel} queue: processing photo ${current} / ${selected}; uploads to the current expected R2 keys. ${completed} finished, ${remaining} left; ${timeLeft}.`;
    }
    return `${sourceLabel} queue: ${completed} / ${selected} photos processed; ${remaining} left; ${gapSummary || "checking R2"}.`;
  };

  const realEstateImportProgress = (logSummary, task = null) => {
    const uploadPayload = logSummary?.realEstateUploadPayload || null;
    const uploadStartPayload = logSummary?.realEstateUploadStartPayload || null;
    const importPayload = logSummary?.realEstateImportPayload || null;
    const clientPayload = logSummary?.realEstateClientPayload || null;
    const payload = uploadPayload || uploadStartPayload || importPayload || {};
    const total = Number(payload.total || clientPayload?.media || 0);
    const completed = Number(payload.completed || 0);
    const percent = total
      ? Math.max(completed ? 1 : 0, Math.min(completed >= total ? 100 : 96, Math.round((completed / total) * 100)))
      : 24;
    const client = String(payload.client || clientPayload?.client || "client");
    const elapsedSeconds = secondsSinceIso(task?.started_at || task?.queued_at || "");
    const secondsLeft = completed >= 5 && total > completed && elapsedSeconds > 0
      ? ((total - completed) / completed) * elapsedSeconds
      : 0;
    const countdown = secondsLeft ? `, rough time left ${formatDuration(secondsLeft)}` : "";
    if (uploadPayload) {
      const failed = Number(uploadPayload.failed || 0);
      return {
        percent,
        detail: `RE upload: ${client} ${formatCount(completed)} / ${formatCount(total)} R2 files uploaded${failed ? `, ${formatCount(failed)} failed` : ""}${countdown}.`,
        completed,
        current: completed,
        total,
        countLabel: "R2 files uploaded",
        client,
        sourceGroup: client,
        failed,
        timeLeft: secondsLeft ? formatDuration(secondsLeft) : "",
      };
    }
    if (uploadStartPayload) {
      return {
        percent,
        detail: `RE upload: ${client} 0 / ${formatCount(total)} R2 files queued${countdown}.`,
        completed: 0,
        current: 0,
        total,
        countLabel: "R2 files queued",
        client,
        sourceGroup: client,
        timeLeft: secondsLeft ? formatDuration(secondsLeft) : "",
      };
    }
    if (importPayload) {
      const album = String(importPayload.album || "");
      const file = String(importPayload.file || "");
      const current = [album, file].filter(Boolean).join(" / ");
      return {
        percent,
        detail: `RE import: ${client} ${formatCount(completed)} / ${formatCount(total)} media checked${current ? `, ${current}` : ""}${countdown}.`,
        completed,
        current: completed,
        total,
        countLabel: "property media checked",
        client,
        sourceGroup: [client, album].filter(Boolean).join(" / "),
        currentFile: file,
        timeLeft: secondsLeft ? formatDuration(secondsLeft) : "",
      };
    }
    return {
      percent: 18,
      detail: "RE sync running",
      completed,
      current: completed,
      total,
      countLabel: "property media checked",
      client,
      sourceGroup: client,
    };
  };

  const sourceLaneHasQueueProgress = (logSummary = null) => Boolean(
    logSummary?.importScanProgressPayload
    || logSummary?.importScanDonePayload
    || logSummary?.importQueueStartPayload
    || logSummary?.importQueueProgressPayload
    || logSummary?.scan
    || logSummary?.started
    || logSummary?.imported
  );

  const sourceLaneHasLogProgress = (phaseKey, logSummary = null) => (
    phaseKey === "real-estate"
      ? Boolean(
        sourceLaneHasQueueProgress(logSummary)
        || logSummary?.realEstateImportPayload
        || logSummary?.realEstateUploadStartPayload
        || logSummary?.realEstateUploadPayload
      )
      : sourceLaneHasQueueProgress(logSummary)
  );

  const sourceLaneProgress = (phaseKey, logSummary = null, task = null) => (
    phaseKey === "real-estate" && !sourceLaneHasQueueProgress(logSummary)
      ? realEstateImportProgress(logSummary, task)
      : cameraImportProgress(logSummary, task)
  );

  const sourceLaneProgressDetail = (phaseKey, progress) => (
    phaseKey === "real-estate" && progress.selected === undefined
      ? progress.detail
      : cameraImportProgressDetail(progress, phaseKey)
  );

  const sourceLaneProgressCountText = (phaseKey, progress = {}) => {
    const sourceLabel = importSourceLabel(phaseKey);
    if (phaseKey === "real-estate" && progress.selected === undefined) {
      if (!progress.total) return `Waiting for ${sourceLabel} media totals.`;
      const current = Math.min(Number(progress.current || progress.completed || 0), Number(progress.total || 0));
      return `${progress.countLabel || "Items"}: ${formatCount(current)} / ${formatCount(progress.total)}.`;
    }
    if (!progress.selected) {
      const inspected = progress.inspectedFiles ? ` ${formatCount(progress.inspectedFiles)} source files inspected so far.` : "";
      return `${sourceLabel} scanner is filling the queue; no needed photos queued yet.${inspected}`;
    }
    if (progress.scanningForMore) {
      const inspected = progress.inspectedFiles ? ` ${formatCount(progress.inspectedFiles)} source files inspected so far.` : "";
      return `${sourceLabel} queue: ${formatCount(progress.completed)} / ${formatCount(progress.selected)} photos processed so far, ${formatCount(progress.queueDepth)} waiting; scanner is still looking for more work.${inspected}`;
    }
    if (progress.scanDraining) {
      return `${sourceLabel} scan complete; queue drain: ${formatCount(progress.completed)} / ${formatCount(progress.selected)} photos processed, ${formatCount(progress.queueDepth)} waiting.`;
    }
    const current = Math.min(Math.max(Number(progress.current || 0), Number(progress.completed || 0)), Number(progress.selected || 0));
    return `${sourceLabel} queue: ${formatCount(current)} / ${formatCount(progress.selected)} photos processed; ${formatCount(progress.completed)} finished.`;
  };

  const gapFillProgress = (logSummary, task = null) => {
    const rows = Array.isArray(logSummary?.importPhotoRows) ? logSummary.importPhotoRows : [];
    const planned = Number(logSummary?.importPlanPayload?.total || task?.total || rows.length || 0);
    const total = Math.max(planned, rows.length);
    const finishedRows = rows.filter((row) => row.status === "done" || row.status === "error").length;
    const stepUnits = rows.reduce((sum, row) => {
      if (row.status === "done" || row.status === "error") return sum + IMPORT_MATRIX_STEPS.length;
      return sum + IMPORT_MATRIX_STEPS.reduce((stepSum, [stepKey]) => {
        const step = row.steps?.[stepKey] || {};
        if (step.status === "skipped" || step.status === "done") return stepSum + 1;
        const stepTotal = Number(step.total || 0);
        if (!stepTotal) return stepSum;
        return stepSum + Math.min(1, Math.max(0, Number(step.completed || 0) / stepTotal));
      }, 0);
    }, 0);
    const totalUnits = total * IMPORT_MATRIX_STEPS.length;
    const percent = totalUnits
      ? Math.max(stepUnits ? 1 : 0, Math.min(finishedRows >= total ? 100 : 99, Math.round((stepUnits / totalUnits) * 100)))
      : 18;
    const current = rows.find((row) => row.status !== "done" && row.status !== "error") || rows.at(-1) || null;
    const donePayload = logSummary?.importDonePayload || {};
    const failed = Number(donePayload.failed || rows.filter((row) => row.status === "error").length || 0);
    const remaining = total ? Math.max(0, total - finishedRows) : 0;
    const currentLabel = current?.id ? ` Current photo: ${current.id}.` : "";
    const suffix = failed ? ` ${formatCount(failed)} failed.` : "";
    return {
      percent,
      detail: total
        ? `Filling upload gaps: ${formatCount(finishedRows)} / ${formatCount(total)} incomplete photos finished; ${formatCount(remaining)} left.${currentLabel}${suffix}`
        : "Filling upload gaps: finding incomplete photos.",
      finishedRows,
      total,
      failed,
      remaining,
    };
  };

  const phaseProgress = (phase, logSummary, failed, task = null) => {
    if (failed) return { percent: 100, detail: phase.key === "coverage" ? coverageMissingDetail() : "Needs attention" };
    if (phase.key === "gap-fill") return gapFillProgress(logSummary, task);
    if ((phase.key === "discard-start" || phase.key === "discard-final") && (logSummary?.deleteProgress || logSummary?.deleteStart || logSummary?.deleted)) {
      if (logSummary?.deleted) {
        return { percent: 100, detail: `Double-check complete: ${logSummary.deleted.match[1]} public and ${logSummary.deleted.match[2]} private key checks` };
      }
      return deleteObjectProgress(logSummary);
    }
    if (PHOTO_IMPORT_PHASES.has(phase.key) && sourceLaneHasLogProgress(phase.key, logSummary)) {
      const progress = sourceLaneProgress(phase.key, logSummary, task);
      return {
        percent: progress.percent,
        detail: sourceLaneProgressDetail(phase.key, progress),
      };
    }
    if (phase.key === "private" && logSummary?.upload) {
      return privateBackfillProgress(logSummary);
    }
    return { percent: 18, detail: "Running" };
  };

  const completedPhaseDetail = (phase, logSummary) => {
    if ((phase.key === "discard-start" || phase.key === "discard-final") && logSummary?.deleted) {
      return `${logSummary.deleted.match[1]} public and ${logSummary.deleted.match[2]} private key checks`;
    }
    if (phase.key === "coverage") return "Satisfied";
    return "Done";
  };

  const ownerCountRowsHtml = (rows, wideLabels = new Set()) => rows.map(([label, value]) => `
    <div class="${wideLabels.has(label) ? "is-wide" : ""}">
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(value)}</dd>
    </div>
  `).join("");

  const importMatrixStepComplete = (step = {}) => {
    if (step.status === "skipped") return false;
    if (step.status === "done") return true;
    const total = Number(step.total || 0);
    return total > 0 && Number(step.completed || 0) >= total;
  };

  const importMatrixStepSettled = (step = {}) => (
    step.status === "skipped" || importMatrixStepComplete(step)
  );

  const importMatrixRowComplete = (photo = {}) => {
    if (photo.status === "error") return false;
    if (photo.status === "done") return true;
    return IMPORT_MATRIX_STEPS.every(([stepKey]) => importMatrixStepSettled(photo.steps?.[stepKey] || {}));
  };

  const importMatrixVisibleInfo = (photos = []) => {
    const incompleteRows = photos.filter((photo) => !importMatrixRowComplete(photo));
    const sortByQueueIndex = (left, right) => Number(left.index || 0) - Number(right.index || 0);
    const runningRows = incompleteRows.filter((photo) => photo.status === "running").sort(sortByQueueIndex);
    const errorRows = incompleteRows.filter((photo) => photo.status === "error").sort(sortByQueueIndex);
    const queuedRows = incompleteRows
      .filter((photo) => photo.status !== "running" && photo.status !== "error")
      .sort(sortByQueueIndex);
    const visibleQueuedRows = queuedRows.slice(0, IMPORT_MATRIX_QUEUE_PREVIEW_LIMIT);
    const incompleteIds = new Set(incompleteRows.map((photo) => photo.id));
    const recentDoneRows = photos
      .filter((photo) => !incompleteIds.has(photo.id) && photo.status === "done")
      .sort((left, right) => Number(right.doneEventIndex || right.lastEventIndex || 0) - Number(left.doneEventIndex || left.lastEventIndex || 0))
      .slice(0, IMPORT_MATRIX_RECENT_DONE_LIMIT);

    const visibleMap = new Map();
    [...runningRows, ...visibleQueuedRows, ...recentDoneRows, ...errorRows].forEach((photo) => {
      if (!visibleMap.has(photo.id)) visibleMap.set(photo.id, photo);
    });
    const rows = [...visibleMap.values()]
      .sort((left, right) => {
        const rank = (photo) => photo.status === "running" ? 0 : photo.status === "done" ? 2 : photo.status === "error" ? 3 : 1;
        return rank(left) - rank(right)
          || (rank(left) === 2
            ? Number(right.doneEventIndex || right.lastEventIndex || 0) - Number(left.doneEventIndex || left.lastEventIndex || 0)
            : Number(left.index || 0) - Number(right.index || 0));
      });
    return {
      rows,
      runningCount: runningRows.length,
      queuedCount: queuedRows.length,
      visibleQueuedCount: visibleQueuedRows.length,
      hiddenQueuedCount: Math.max(0, queuedRows.length - visibleQueuedRows.length),
      doneCount: recentDoneRows.length,
      errorCount: errorRows.length,
    };
  };

  const importMatrixVisibleRows = (photos = []) => {
    const info = importMatrixVisibleInfo(photos);
    return info.rows;
  };

  const importMatrixCellHtml = (photo, stepKey, stepLabel) => {
    const step = photo.steps?.[stepKey] || {};
    const skipped = step.status === "skipped";
    const checked = importMatrixStepComplete(step);
    const total = Number(step.total || 0);
    const completed = Number(step.completed || 0);
    const count = total > 1 && !skipped ? `<span>${formatCount(Math.min(completed, total))}/${formatCount(total)}</span>` : "";
    const label = `${stepLabel}: ${photo.id}`;
    const classes = [
      checked ? "is-checked" : "is-pending",
      skipped ? "is-skipped" : "",
    ].filter(Boolean).join(" ");
    return `
      <td class="${classes}">
        <input type="checkbox" disabled ${checked ? "checked" : ""} aria-label="${escapeHtml(label)}">
        ${skipped ? "<span>n/a</span>" : count}
      </td>
    `;
  };

  const importMatrixHtml = (photos = []) => {
    if (!photos.length) return "";
    const visibleInfo = importMatrixVisibleInfo(photos);
    const visibleRows = visibleInfo.rows;
    if (!visibleRows.length) return "";
    const meta = [
      visibleInfo.runningCount ? `${formatCount(visibleInfo.runningCount)} working` : "",
      visibleInfo.visibleQueuedCount ? `${formatCount(visibleInfo.visibleQueuedCount)} next queued` : "",
      visibleInfo.doneCount ? `${formatCount(visibleInfo.doneCount)} just finished` : "",
      visibleInfo.hiddenQueuedCount ? `${formatCount(visibleInfo.hiddenQueuedCount)} more queued hidden` : "",
      visibleInfo.errorCount ? `${formatCount(visibleInfo.errorCount)} needs attention` : "",
    ].filter(Boolean).join(" · ");
    return `
      <div class="owner-import-matrix-wrap" aria-label="Per-photo import progress">
        ${meta ? `<div class="owner-import-matrix-meta">${escapeHtml(meta)}</div>` : ""}
        <table class="owner-import-matrix">
          <thead>
            <tr>
              <th>Step</th>
              ${IMPORT_MATRIX_STEPS.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${visibleRows.map((photo) => `
              <tr class="owner-import-matrix-photo-row ${photo.status === "done" ? "is-done" : photo.status === "error" ? "is-error" : ""}">
                <th scope="rowgroup" colspan="${IMPORT_MATRIX_STEPS.length + 1}">
                  <strong>${escapeHtml(photo.id)}</strong>
                  <span>${escapeHtml(photo.relativePath || photo.country || "")}</span>
                </th>
              </tr>
              <tr class="owner-import-matrix-step-row ${photo.status === "done" ? "is-done" : photo.status === "error" ? "is-error" : ""}">
                <th scope="row">${escapeHtml(photo.status === "queued" ? "Next up" : photo.status === "running" ? "Working" : photo.status === "done" ? "Finished" : photo.status === "error" ? "Needs attention" : "Steps")}</th>
                ${IMPORT_MATRIX_STEPS.map(([stepKey, label]) => importMatrixCellHtml(photo, stepKey, label)).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  };

  const phaseStatusLabel = (state) => {
    if (state === "done") return "Done";
    if (state === "running") return "Running";
    if (state === "failed") return "Needs attention";
    if (state === "skipped") return "Unfinished";
    return "Waiting";
  };

  const activeR2RepairTask = () => latestR2ProgressTasks.find((task) =>
    task?.operation === "repair" && (task.state === "queued" || task.state === "running")
  ) || null;

  const requestCurrentSweepPhaseSkip = async (phaseKey) => {
    const response = await fetch("/__photosbyelie/r2-skip-phase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phaseKey }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Could not skip this R2 phase.");
    return payload;
  };

  const phaseListForTask = (task) => {
    if (task?.operation === "gap-fill") return SWEEP_PHASES.filter((phase) => phase.key === "gap-fill");
    if (task?.operation === "imports-idle") {
      return SWEEP_PHASES.filter((phase) => IMPORT_DASHBOARD_PHASE_KEYS.includes(phase.key));
    }
    return SWEEP_PHASES.filter((phase) => phase.key !== "gap-fill");
  };

  const phaseLabelForKey = (phaseKey, task = null) => (
    phaseListForTask(task).find((phase) => phase.key === phaseKey)?.label
    || SWEEP_PHASES.find((phase) => phase.key === phaseKey)?.label
    || ""
  );

  const renderSweepPhases = (task, logSummary = null, detailRowsByPhase = new Map(), matrixRowsByPhase = new Map()) => {
    if (!r2Phases) return;
    if (!task || !["repair", "gap-fill", "imports-idle"].includes(task.operation)) {
      r2PhaseRenderSnapshot = null;
      setHtml(r2Phases, "");
      return;
    }
    const phaseList = phaseListForTask(task);
    r2PhaseRenderSnapshot = { task, logSummary, detailRowsByPhase, matrixRowsByPhase };
    const active = task.state === "queued" || task.state === "running";
    const coverageIncomplete = task.operation !== "gap-fill" && !active && task.state === "done" && r2CoverageOk === false;
    const failed = Number(task.failed || 0) > 0 || task.state === "failed" || coverageIncomplete;
    const complete = !active && !failed && task.state === "done";
    const activeKey = coverageIncomplete ? "coverage" : (active && task?.currentPhaseKey) || logSummary?.phaseKey || task?.currentPhaseKey || "prepare";
    const activeIndex = Math.max(0, phaseList.findIndex((phase) => phase.key === activeKey));
    const doneKeys = logSummary?.doneKeys || new Set();
    const skippedKeys = new Set([
      ...([...((logSummary?.skippedKeys instanceof Set ? logSummary.skippedKeys : new Set()))]),
      ...((Array.isArray(task?.skipPhases) ? task.skipPhases : []).filter(Boolean)),
    ]);
    const wideLabels = new Set(["Already done", "Cleanup record", "Current phase", "Current file", "Current photo", "Source group", "Owner DB trusted", "Progress bar counts", "Progress summary", "Upload progress", "Upload matrix", "Coverage gaps", "Needs attention", "Notes", "Safe skip", "Skip", "What happens", "Last photo", "Last synced", "Latest error", "Latest log"]);
    const genericProgressDetails = new Set(["Waiting", "Running", "Done", "Satisfied", "Needs attention"]);
    setHtml(r2Phases, phaseList.map((phase, index) => {
      const explicitDone = doneKeys.has(phase.key);
      const explicitSkipped = skippedKeys.has(phase.key);
      const isActive = phase.key === activeKey && active;
      const isFailed = phase.key === activeKey && failed;
      const inferredDone = (active || coverageIncomplete) && index < activeIndex && (!phase.optional || explicitDone);
      const completeDone = complete && (!phase.optional || explicitDone);
      const isSkipped = explicitSkipped || (phase.optional && !explicitDone && !isActive && (complete || index < activeIndex));
      const state = isFailed ? "failed" : isActive ? "running" : isSkipped ? "skipped" : completeDone || explicitDone || inferredDone ? "done" : "pending";
      const progress = state === "done"
        ? { percent: 100, detail: completedPhaseDetail(phase, logSummary) }
        : state === "running"
          ? phaseProgress(phase, logSummary, false, task)
          : state === "failed"
            ? phaseProgress(phase, logSummary, true, task)
            : { percent: 0, detail: state === "skipped" ? "Unfinished" : "Waiting" };
      const phaseRows = detailRowsByPhase instanceof Map ? (detailRowsByPhase.get(phase.key) || []) : [];
      const matrixRows = matrixRowsByPhase instanceof Map ? (matrixRowsByPhase.get(phase.key) || []) : [];
      const hasProgressNote = Boolean(progress.detail && !genericProgressDetails.has(progress.detail));
      const canExpand = (state === "done" || state === "failed") && (phaseRows.length || matrixRows.length || hasProgressNote);
      const showPhaseDetails = state === "running" || (canExpand && expandedSweepPhaseKeys.has(phase.key));
      const matrixHtml = showPhaseDetails && matrixRows.length ? importMatrixHtml(matrixRows) : "";
      const hasMatrix = Boolean(matrixHtml);
      const detailHtml = showPhaseDetails && phaseRows.length
        ? `<dl class="owner-counts owner-sweep-details">${ownerCountRowsHtml(phaseRows, wideLabels)}</dl>`
        : "";
      const progressNote = showPhaseDetails && hasProgressNote
        ? `<p class="owner-sweep-progress-note">${escapeHtml(progress.detail)}</p>`
        : "";
      const canSkipCurrent = state === "running" && SWEEP_SKIPPABLE_KEYS.has(phase.key);
      const skipButton = canSkipCurrent
        ? `<button class="owner-sweep-phase-skip" type="button" data-owner-sweep-skip="${escapeHtml(phase.key)}">Skip to next phase</button>`
        : "";
      const toggleAttrs = canExpand
        ? ` data-owner-sweep-phase-toggle="${escapeHtml(phase.key)}" role="button" tabindex="0" aria-expanded="${showPhaseDetails ? "true" : "false"}" aria-label="${escapeHtml(`${phase.label}: ${showPhaseDetails ? "collapse" : "expand"} details`)}"`
        : "";
      return `
        <div class="owner-sweep-phase is-${state}${canExpand ? " can-expand" : ""}${showPhaseDetails ? " is-expanded" : ""}${hasMatrix ? " has-matrix" : ""}"${toggleAttrs}>
          <div class="owner-sweep-phase-copy">
            <strong>${escapeHtml(phase.label)}</strong>
            <span>${escapeHtml(task.operation === "imports-idle" && state === "pending" ? "Idle" : phaseStatusLabel(state))}</span>
            ${skipButton}
          </div>
          <div class="owner-sweep-phase-progress">
            <div class="owner-sweep-bar" aria-label="${escapeHtml(phase.label)} progress">
              <span style="width:${progress.percent}%"></span>
            </div>
            ${progressNote}
            ${matrixHtml}
            ${detailHtml}
          </div>
        </div>
      `;
    }).join(""));
  };

  const renderR2RepairProgress = (latest, logSummary = null) => {
    const active = latest.state === "queued" || latest.state === "running";
    const gapFill = latest.operation === "gap-fill";
    const coverageIncomplete = !gapFill && !active && latest.state === "done" && r2CoverageOk === false;
    const failureCount = Number(latest.failed || 0);
    const failed = failureCount > 0 || latest.state === "failed" || coverageIncomplete;
    const activePhaseKey = coverageIncomplete ? "coverage" : (active && latest.currentPhaseKey) || logSummary?.phaseKey || latest.currentPhaseKey || "prepare";
    const activePhaseLabel = phaseLabelForKey(activePhaseKey, latest) || logSummary?.phase || "Current phase";
    const logMatchesActivePhase = !active || !logSummary?.phaseKey || logSummary.phaseKey === activePhaseKey;
    if (active) {
      if (latest.external_pid) {
        setText(r2Summary, activePhaseLabel
          ? `${activePhaseLabel}. Existing sweep pid ${latest.external_pid}.`
          : `Cloud media sweep is already running with pid ${latest.external_pid}.`);
      } else {
        setText(r2Summary, gapFill
          ? `${activePhaseLabel}: completing the missing upload matrix.`
          : activePhaseLabel
          ? `${activePhaseLabel}.`
          : "Running the lock-guarded cloud media sweep.");
      }
    } else if (failed) {
      setText(r2Summary, gapFill
        ? "Fill in gaps stopped before all missing uploads completed."
        : coverageIncomplete
        ? `R2 repair finished, but coverage is still missing (${coverageMissingDetail()}).`
        : logSummary?.phase === "Needs attention"
        ? "R2 coverage repair needs attention."
        : "R2 coverage repair stopped before completion.");
    } else {
      setText(r2Summary, gapFill ? "Last upload gap fill finished." : "Last R2 coverage repair finished.");
    }
    const detailRowsByPhase = new Map();
    const matrixRowsByPhase = new Map();
    const addPhaseRow = (phaseKey, label, value) => {
      if (!detailRowsByPhase.has(phaseKey)) detailRowsByPhase.set(phaseKey, []);
      detailRowsByPhase.get(phaseKey).push([label, value]);
    };
    let lastPhotoId = "";
    if (latest.external_pid) addPhaseRow(activePhaseKey, "Sweep PID", latest.external_pid);
    if (logMatchesActivePhase && (PHOTO_IMPORT_PHASES.has(activePhaseKey) || activePhaseKey === "gap-fill") && logSummary?.importPhotoRows?.length) {
      const visibleMatrixInfo = importMatrixVisibleInfo(logSummary.importPhotoRows);
      const visibleMatrixRows = visibleMatrixInfo.rows;
      const sourceProgress = PHOTO_IMPORT_PHASES.has(activePhaseKey)
        ? sourceLaneProgress(activePhaseKey, logSummary, latest)
        : null;
      if (visibleMatrixRows.length) matrixRowsByPhase.set(activePhaseKey, logSummary.importPhotoRows);
      addPhaseRow(
        activePhaseKey,
        "Upload matrix",
        visibleMatrixInfo.runningCount || visibleMatrixInfo.visibleQueuedCount
          ? `${formatCount(visibleMatrixInfo.runningCount)} working, ${formatCount(visibleMatrixInfo.visibleQueuedCount)} next queued shown${visibleMatrixInfo.hiddenQueuedCount ? `, ${formatCount(visibleMatrixInfo.hiddenQueuedCount)} more queued hidden` : ""}${visibleMatrixInfo.doneCount ? `, ${formatCount(visibleMatrixInfo.doneCount)} just finished` : ""}`
          : visibleMatrixInfo.doneCount
          ? `${formatCount(visibleMatrixInfo.doneCount)} just finished`
          : sourceProgress?.scanningForMore
          ? `No active rows right now; scanning for more ${importSourceLabel(activePhaseKey)} work`
          : "No active rows",
      );
    }
    if (logMatchesActivePhase && activePhaseKey === "gap-fill") {
      const progress = gapFillProgress(logSummary, latest);
      addPhaseRow("gap-fill", "Progress summary", `${formatCount(progress.finishedRows)} / ${formatCount(progress.total)} incomplete photos finished`);
      if (progress.failed) addPhaseRow("gap-fill", "Needs attention", `${formatCount(progress.failed)} photos failed`);
      addPhaseRow("gap-fill", "What happens", "For each incomplete photo: upload the master, create private JPG triplets, upload triplets, create previews, then upload previews before moving to the next photo.");
    }
    if (logMatchesActivePhase && activePhaseKey === "private") {
      const progress = privateBackfillProgress(logSummary);
      addPhaseRow("private", "Progress bar counts", `${progress.detail} catalog photos with complete private delivery JPG triplets.`);
      addPhaseRow("private", "What happens", "Builds missing private delivery JPGs in the 6MP, 3MP, and 1MP sizes, uploads them to private R2, and refreshes the private delivery manifest for checkout ZIPs.");
      addPhaseRow("private", "Notes", "This is not importing new photos or public previews. It runs after the catalog is written so existing still photos have private customer-download JPGs available.");
      if (logSummary?.upload) addPhaseRow("private", "Last upload", `${logSummary.upload.match[2]} uploaded ${formatCount(Number(logSummary.upload.match[3] || 0))} private files`);
    }
    if (logMatchesActivePhase && (logSummary?.deleteStart || logSummary?.deleteProgress || logSummary?.deleted)) {
      const progress = deleteObjectProgress(logSummary);
      const deletePhaseKey = logSummary?.phaseKey === "discard-final" ? "discard-final" : "discard-start";
      if (progress.total) addPhaseRow(deletePhaseKey, "Progress summary", `${formatCount(progress.completed)} of ${formatCount(progress.total)} banned-photo R2 key checks complete`);
      addPhaseRow(deletePhaseKey, "Already done", "Historical cleanup is recorded. This phase is a safe double-check for leftover R2 objects at old banned-photo keys.");
      if (active && progress.countdown && progress.total > progress.completed) addPhaseRow(deletePhaseKey, "Time left estimate", progress.countdown);
      if (progress.publicTotal || progress.privateTotal) {
        addPhaseRow(
          deletePhaseKey,
          "Public/private",
          `${formatCount(progress.publicCompleted)} / ${formatCount(progress.publicTotal)} public, ${formatCount(progress.privateCompleted)} / ${formatCount(progress.privateTotal)} private`,
        );
      }
      if (progress.discardedPhotos) addPhaseRow(deletePhaseKey, "Banned photos", formatCount(progress.discardedPhotos));
      if (logSummary?.deleteContextPayload) {
        const currentDiscarded = Number(logSummary.deleteContextPayload.currentDiscardedPhotos || 0);
        const historicalDiscarded = Number(logSummary.deleteContextPayload.historicalDiscardedPhotos || 0);
        const ownerDbConfirmed = Number(logSummary.deleteContextPayload.ownerDbDeletedConfirmed || 0);
        addPhaseRow(
          deletePhaseKey,
          "Cleanup record",
          `${formatCount(historicalDiscarded)} historical IDs recorded${currentDiscarded ? `, ${formatCount(currentDiscarded)} current tombstones` : ""}`,
        );
        if (ownerDbConfirmed) addPhaseRow(deletePhaseKey, "Owner DB trusted", `${formatCount(ownerDbConfirmed)} key checks already confirmed deleted`);
      }
    }
    const importPhaseKey = PHOTO_IMPORT_PHASES.has(activePhaseKey) ? activePhaseKey : "camera";
    let sourceLaneDetails = null;
    const mergeSourceLaneDetails = (details = {}) => {
      sourceLaneDetails = { ...(sourceLaneDetails || {}), ...Object.fromEntries(
        Object.entries(details).filter(([, value]) => {
          if (Array.isArray(value)) return value.length > 0;
          return value !== undefined && value !== null && String(value).trim() !== "";
        }),
      ) };
    };
    if (PHOTO_IMPORT_PHASES.has(activePhaseKey) && !logSummary?.upload) mergeSourceLaneDetails({});
    if (logMatchesActivePhase && activePhaseKey === "real-estate") {
      const clientPayload = logSummary?.realEstateClientPayload || {};
      const importPayload = logSummary?.realEstateImportPayload || {};
      const uploadStartPayload = logSummary?.realEstateUploadStartPayload || {};
      const uploadPayload = logSummary?.realEstateUploadPayload || {};
      const donePayload = logSummary?.realEstateDonePayload || {};
      const progress = sourceLaneProgress(activePhaseKey, logSummary, latest);
      const client = String(uploadPayload.client || uploadStartPayload.client || importPayload.client || clientPayload.client || "");
      const sourceGroup = [client, importPayload.album].filter(Boolean).join(" / ");
      const importTotal = Number(importPayload.total || clientPayload.media || 0);
      const importCompleted = Number(importPayload.completed || 0);
      const uploadTotal = Number(uploadPayload.total || uploadStartPayload.total || 0);
      const uploadCompleted = Number(uploadPayload.completed || 0);
      const failedUploads = Number(uploadPayload.failed || 0);
      const notes = [
        clientPayload.properties ? `${formatCount(Number(clientPayload.properties || 0))} properties available.` : "",
        Array.isArray(clientPayload.missingProperties) && clientPayload.missingProperties.length
          ? `Skipping missing properties: ${clientPayload.missingProperties.join(", ")}.`
          : "",
        donePayload.clients ? `${formatCount(Number(donePayload.clients || 0))} clients synced.` : "",
      ];
      mergeSourceLaneDetails({
        sourceGroup: progress.sourceGroup || sourceGroup,
        currentFile: progress.currentFile || importPayload.file,
        progressCounts: sourceLaneProgressCountText(activePhaseKey, progress),
        progressSummary: importTotal
          ? `${formatCount(importCompleted)} / ${formatCount(importTotal)} property media checked`
          : "",
        finishedSummary: importTotal
          ? `${formatCount(importCompleted)} synced, ${formatCount(Math.max(0, importTotal - importCompleted))} left`
          : "",
        uploadProgress: uploadTotal
          ? `${formatCount(uploadCompleted)} / ${formatCount(uploadTotal)} R2 files uploaded${failedUploads ? `, ${formatCount(failedUploads)} failed` : ""}`
          : "",
        timeLeft: progress.timeLeft,
        notes,
      });
    }
    if (logMatchesActivePhase && logSummary?.started && !logSummary?.upload) {
      const progress = PHOTO_IMPORT_PHASES.has(activePhaseKey)
        ? sourceLaneProgress(activePhaseKey, logSummary, latest)
        : null;
      if (!progress?.selected || progress.completed < progress.selected) {
        mergeSourceLaneDetails({
          sourceGroup: logSummary.started.match[3],
          currentFile: logSummary.started.match[4],
        });
      }
    }
    if (logMatchesActivePhase && sourceLaneHasQueueProgress(logSummary) && !logSummary?.upload) {
      const progress = sourceLaneProgress(activePhaseKey, logSummary, latest);
      if (progress.selected) {
        const gapSummary = coverageRepairGapSummary();
        const scanner = progress.scanDone
          ? `Scan complete: ${formatCount(progress.scannedFiles)} source files seen, ${formatCount(progress.inspectedFiles)} inspected.`
          : `Scanning: ${formatCount(progress.scannedFiles)} source files seen, ${formatCount(progress.inspectedFiles)} inspected so far.`;
        const planner = progress.plannerActive || progress.planQueueDepth
          ? `Planning metadata and R2 coverage: ${formatCount(progress.planQueueDepth)} scan batches waiting${progress.plannerActive ? ", 1 active" : ""}.`
          : "Planner is caught up.";
        const queue = `${formatCount(progress.completed)} processed, ${formatCount(progress.queueDepth)} waiting${progress.activeItemCount ? ", 1 active" : ""}, ${formatCount(progress.selected)} queued so far.`;
        mergeSourceLaneDetails({
          coverageGaps: gapSummary,
          currentPhoto: progress.completed < progress.selected ? progress.photo : "",
          scanner,
          planner,
          queue,
          progressCounts: sourceLaneProgressCountText(activePhaseKey, progress),
          progressSummary: `${formatCount(Math.min(progress.current, progress.selected))} / ${formatCount(progress.selected)} queued photos processed this run`,
          finishedSummary: `${formatCount(progress.completed)} synced, ${formatCount(progress.remaining)} left in the known queue`,
          notes: "Not found at the current expected R2 key; a file can still exist under an older or wrong-place key.",
        });
      } else {
        mergeSourceLaneDetails({
          currentPhoto: progress.completed < progress.selected ? progress.photo : "",
          scanner: `Scanning: ${formatCount(progress.scannedFiles)} source files seen, ${formatCount(progress.inspectedFiles)} inspected so far.`,
          planner: progress.plannerActive || progress.planQueueDepth
            ? `Planning metadata and R2 coverage: ${formatCount(progress.planQueueDepth)} scan batches waiting${progress.plannerActive ? ", 1 active" : ""}.`
            : "Planner is waiting for source batches.",
          queue: "No needed photos queued yet.",
          progressCounts: sourceLaneProgressCountText(activePhaseKey, progress),
        });
      }
      if (active && progress.selected > progress.completed) mergeSourceLaneDetails({ timeLeft: progress.countdown });
      if (logSummary?.imported) {
        mergeSourceLaneDetails({
          uploadProgress: `${logSummary.imported.match[5]} private renders`,
        });
      }
    }
    if (sourceLaneDetails) {
      sourceLaneDetailRows(importPhaseKey, sourceLaneDetails).forEach(([label, value]) => {
        addPhaseRow(importPhaseKey, label, value);
      });
    }
    if (logSummary?.upload) {
      lastPhotoId = logSummary.upload.match[2];
      addPhaseRow("private", "Last photo", lastPhotoId);
      addPhaseRow("private", "Collection", collectionLabelForPhoto(lastPhotoId) || "unknown");
    }
    if (logSummary?.manifest) addPhaseRow("sidecar", "Render triplets", logSummary.manifest.match[1]);
    if (logSummary?.processed) addPhaseRow(activePhaseKey, "Processed", logSummary.processed.match[1]);
    if (coverageIncomplete) addPhaseRow("coverage", "Coverage", coverageMissingDetail());
    if (Array.isArray(latest.errors) && latest.errors.length) addPhaseRow(activePhaseKey, "Latest error", latest.errors.at(-1));
    if (logSummary?.error && (!active || logSummary.error.line === logSummary.latest)) addPhaseRow(activePhaseKey, "Latest error", logSummary.error.line);
    else if (logSummary?.latest && !active) addPhaseRow(activePhaseKey, "Latest log", logSummary.latest);
    if (active) {
      const activeRows = detailRowsByPhase.get(activePhaseKey) || [];
      const activeLabel = phaseLabelForKey(activePhaseKey, latest) || logSummary?.phase || "Current phase";
      if (!activeRows.length) {
        addPhaseRow(activePhaseKey, "Current phase", logSummary?.phase || activeLabel);
      }
      if (SWEEP_SKIPPABLE_KEYS.has(activePhaseKey)) {
        addPhaseRow(activePhaseKey, "Safe skip", "Stops this phase command, keeps completed work, and lets the sweep continue with the next phase.");
      } else {
        addPhaseRow(activePhaseKey, "Skip", "Not shown for this short handoff phase.");
      }
    }
    if (!active) addPhaseRow(activePhaseKey, "Result", coverageIncomplete ? "coverage still missing" : failed ? `${failureCount || 1} failed` : "complete");
    if (!detailRowsByPhase.size) addPhaseRow(activePhaseKey, "State", latest.state || "queued");
    renderSweepPhases(latest, logSummary, detailRowsByPhase, matrixRowsByPhase);
    setHtml(r2Counts, "");
    renderR2PhotoPreview(lastPhotoId);
  };

  const toggleSweepPhaseDetails = (phaseKey) => {
    if (!phaseKey || !r2PhaseRenderSnapshot) return;
    if (expandedSweepPhaseKeys.has(phaseKey)) {
      expandedSweepPhaseKeys.delete(phaseKey);
    } else {
      expandedSweepPhaseKeys.add(phaseKey);
    }
    renderSweepPhases(
      r2PhaseRenderSnapshot.task,
      r2PhaseRenderSnapshot.logSummary,
      r2PhaseRenderSnapshot.detailRowsByPhase,
      r2PhaseRenderSnapshot.matrixRowsByPhase,
    );
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

  const renderImportDashboardIdle = () => {
    if (!r2Card || !r2Summary || !r2Counts) return;
    if (r2Card.hidden) r2Card.hidden = false;
    setText(r2Summary, r2CoverageOk
      ? "No import job is running. Everything currently tracked is up to date."
      : `No import job is running. Not up to date yet: ${r2GapStatusText()}`
    );
    const gaps = r2GapCounts();
    const rows = [
      ["State", "Idle"],
      ["Coverage", window.photosByElieR2Coverage ? (r2CoverageOk ? "Up to date" : "Needs work") : "Loading"],
      ["Incomplete photos", window.photosByElieR2Coverage ? formatCount(gaps.photos) : "Checking"],
      ["Missing work", window.photosByElieR2Coverage ? r2GapStatusText() : "Checking R2 coverage"],
    ];
    setHtml(r2Counts, ownerCountRowsHtml(rows, new Set(["Missing work"])));
    renderSweepPhases({
      id: "imports-idle",
      operation: "imports-idle",
      state: "idle",
      currentPhaseKey: "camera",
      failed: 0,
    });
    renderR2PhotoPreview("");
  };

  const loadR2RepairLog = async (task) => {
    if (!task?.id || !["repair", "gap-fill"].includes(task.operation)) return;
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
      const active = task.state === "queued" || task.state === "running";
      const shouldRefreshCoverage = !active
        || !window.photosByElieR2Coverage
        || Date.now() - lastImportCoverageRefreshAt > 30000;
      if (shouldRefreshCoverage) {
        lastImportCoverageRefreshAt = Date.now();
        withTimeout(loadR2Coverage(), 12000, "R2 coverage refresh")
          .then(() => {
            if (r2RepairLogToken === token) renderR2RepairProgress(task, r2RepairLogSummary);
          })
          .catch(() => {});
      }
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
    r2RepairActive = tasks.some((task) => task?.operation === "repair" && (task.state === "queued" || task.state === "running"));
    r2GapFillActive = tasks.some((task) => task?.operation === "gap-fill" && (task.state === "queued" || task.state === "running"));
    const latest = tasks.find((task) => task?.operation === "repair" || task?.operation === "gap-fill");
    if (!latest) {
      r2RepairActive = false;
      r2GapFillActive = false;
      r2RepairLogTaskId = "";
      r2RepairLogSummary = null;
      renderImportDashboardIdle();
      syncR2ActionButtons();
      return;
    }
    if (r2Card.hidden) r2Card.hidden = false;
    const total = Number(latest.total || 0);
    const completed = Number(latest.completed || 0);
    const failed = Number(latest.failed || 0);
    const active = latest.state === "queued" || latest.state === "running";
    const isDelete = latest.operation === "delete";
    const isRepair = latest.operation === "repair";
    const isGapFill = latest.operation === "gap-fill";
    syncR2ActionButtons();
    const activeVerb = isRepair ? "Repairing" : isDelete ? "Deleting" : "Uploading";
    const noun = isRepair ? "repair" : isDelete ? "delete" : "upload";
    if (isRepair || isGapFill) {
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
    setHtml(r2Counts, ownerCountRowsHtml(rows));
  };

  const renderR2Coverage = (coverage = null) => {
    if (!r2CoverageCard || !r2CoverageSummary || !r2CoverageCounts || !r2CoverageNote) return;
    if (!coverage) {
      r2CoverageOk = false;
      window.photosByElieR2Coverage = null;
      r2CoverageSummary.textContent = "R2 coverage is unavailable.";
      r2CoverageCounts.innerHTML = "";
      if (r2CoverageMissing) {
        r2CoverageMissing.hidden = true;
        r2CoverageMissing.innerHTML = "";
      }
      r2CoverageNote.textContent = "";
      if (r2FixButton) r2FixButton.disabled = true;
      r2FillGapsButtons.forEach((button) => {
        button.disabled = true;
      });
      renderImportDashboardIdle();
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
    const missingImportPhotos = Array.isArray(coverage.missingImportPhotos)
      ? coverage.missingImportPhotos.map((item, index) => ({
        id: String(item.photoId || item.id || ""),
        index: index + 1,
        relativePath: String(item.relativePath || item.sourceFile || ""),
        country: String(item.collectionKey || ""),
        mediaType: String(item.mediaType || ""),
        status: "pending",
        steps: item.steps || {},
      }))
      : [];
    if (r2CoverageMissing) {
      r2CoverageMissing.hidden = missingPrivateDelivery.length === 0 && missingImportPhotos.length === 0;
      const masterCount = missingImportPhotos.filter((photo) => photo.steps?.master_uploaded?.status === "pending").length;
      const previewCount = missingImportPhotos.filter((photo) => photo.steps?.previews_uploaded?.status === "pending").length;
      const tripletCount = missingImportPhotos.filter((photo) => photo.steps?.triplets_uploaded?.status === "pending").length;
      r2CoverageMissing.innerHTML = missingImportPhotos.length ? `
        <h3>Photos needing upload work</h3>
        <p>${escapeHtml(`${formatCount(missingImportPhotos.length)} incomplete photos: ${formatCount(masterCount)} need masters, ${formatCount(tripletCount)} need private JPG triplets, ${formatCount(previewCount)} need public previews.`)}</p>
        ${importMatrixHtml(missingImportPhotos)}
      ` : missingPrivateDelivery.length ? `
          <h3>Missing private delivery files</h3>
          <p>${escapeHtml(formatCount(missingPrivateDelivery.length))} shown. Start background work runs the Saturn-backed sweep, uploads missing masters when the source file exists, and rebuilds missing photo JPG triplets.</p>
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
      : "Missing coverage. Fill in gaps completes the listed upload work and opens Imports; the Imports tab can also run the full R2 sweep.";
    r2CoverageOk = coverage.ok;
    if (blockedPreviewCountRoot) blockedPreviewCountRoot.textContent = formatCount(blockedCloudMediaCountFromCoverage());
    if (latestR2ProgressTasks.length) renderWasteBasketProgress(latestR2ProgressTasks);
    if (r2FixButton) r2FixButton.dataset.coverageOk = coverage.ok ? "true" : "false";
    if (!latestR2ProgressTasks.some((task) => task?.operation === "repair" || task?.operation === "gap-fill")) {
      renderImportDashboardIdle();
    }
    if (r2FixButton || r2FillGapsButtons.length) {
      syncR2ActionButtons();
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
      const repairLikeTask = tasks.find((task) => task?.operation === "repair" || task?.operation === "gap-fill");
      if (repairLikeTask) await loadR2RepairLog(repairLikeTask);
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
        await withTimeout(loadR2Progress(), 12000, "Import dashboard refresh");
        setStatus("Import dashboard refreshed.");
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
    r2PollTimer = window.setInterval(loadR2Progress, 900);
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
      markRealEstateRowSelected(clientId);
      renderRealEstateClients();
      const selected = selectedRealEstateClient();
      setRealEstateStatus(selected ? `${selected.customer} selected.` : "No real estate client selected.");
      focusRealEstateClientField(clientId, "customer");
      return;
    }
    const inlineControl = event.target.closest("[data-owner-re-inline-field]");
    if (inlineControl) {
      const clientId = inlineControl.dataset.ownerReClientId || inlineControl.closest("[data-owner-re-client]")?.dataset.ownerReClient || "";
      const selected = markRealEstateRowSelected(clientId);
      if (selected) setRealEstateStatus(selected.isDraft ? "Editing new client draft." : `${selected.customer || selected.id} selected.`);
      return;
    }
    const row = event.target.closest("[data-owner-re-client]");
    if (!row) return;
    markRealEstateRowSelected(row.dataset.ownerReClient || "");
    renderRealEstateClients();
    const selected = selectedRealEstateClient();
    setRealEstateStatus(selected ? `${selected.customer} selected.` : "No real estate client selected.");
  });

  realEstateClientList?.addEventListener("input", (event) => {
    const control = event.target.closest("[data-owner-re-inline-field]");
    if (!control) return;
    const client = updateRealEstateClientFromControl(control);
    if (!client) return;
    if (control.dataset.ownerReInlineField === "customer") updateRealEstateComputed(client.customer || "");
    const label = client.customer || "New client";
    setRealEstateStatus(client.isDraft
      ? `${label}: fill client and password; it saves automatically when both are present.`
      : `${label}: change will save when you leave the field.`);
  });

  realEstateClientList?.addEventListener("change", (event) => {
    const control = event.target.closest("[data-owner-re-inline-field]");
    if (!control) return;
    const client = updateRealEstateClientFromControl(control);
    if (client) saveRealEstateInlineClient(client.id);
  });

  realEstateClientList?.addEventListener("keydown", (event) => {
    const control = event.target.closest("[data-owner-re-inline-field]");
    if (!control || control.tagName === "TEXTAREA" || event.key !== "Enter") return;
    event.preventDefault();
    control.blur();
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
    const authorized = await ownerAuth?.requireAuth?.("Start the local Photos By Elie server to run R2 background work.");
    if (ownerAuth?.enabled && !authorized) return;
    const ok = window.confirm("Start the full lock-guarded cloud media background work now? This may upload/render missing objects, double-check banned-photo R2 cleanup, delete any leftovers while keeping ban records, validate, commit, and push manifest changes.");
    if (!ok) return;
    r2FixButton.disabled = true;
    setStatus("Starting R2 background work...");
    try {
      const response = await fetch("/__photosbyelie/r2-fix", {
        method: "POST",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Could not start R2 background work.");
      r2RepairActive = true;
      syncR2ActionButtons();
      setStatus("R2 background work started.");
      setOwnerTab("imports");
      renderR2Progress([payload.task]);
      loadR2Progress();
    } catch (error) {
      r2RepairActive = false;
      syncR2ActionButtons();
      setStatus(error?.message || "Could not start R2 background work.");
      loadR2Coverage();
    }
  });

  const startR2GapFill = async (triggerButton = null) => {
    const authorized = await ownerAuth?.requireAuth?.("Start the local Photos By Elie server to fill R2 upload gaps.");
    if (ownerAuth?.enabled && !authorized) return;
    const gapCount = r2GapPhotoCount();
    if (!gapCount) {
      setStatus("No upload gaps are listed right now.");
      return;
    }
    const ok = window.confirm(`Fill upload gaps for ${formatCount(gapCount)} incomplete photos now? This uploads one photo at a time and updates the owner databases after each successful R2 object.`);
    if (!ok) return;
    if (triggerButton) triggerButton.disabled = true;
    setStatus("Starting R2 upload gap fill...");
    try {
      const response = await fetch("/__photosbyelie/r2-fill-gaps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Could not start R2 upload gap fill.");
      r2GapFillActive = true;
      syncR2ActionButtons();
      setStatus("R2 upload gap fill started.");
      setOwnerTab("imports");
      renderR2Progress([payload.task]);
      loadR2Progress();
    } catch (error) {
      r2GapFillActive = false;
      syncR2ActionButtons();
      setStatus(error?.message || "Could not start R2 upload gap fill.");
      loadR2Coverage();
    }
  };

  r2FillGapsButtons.forEach((button) => {
    button.addEventListener("click", () => startR2GapFill(button));
  });

  r2Phases?.addEventListener("click", async (event) => {
    const skipButton = event.target instanceof Element ? event.target.closest("[data-owner-sweep-skip]") : null;
    if (skipButton && r2Phases.contains(skipButton)) {
      const phaseKey = skipButton.dataset.ownerSweepSkip || "";
      if (!SWEEP_SKIPPABLE_KEYS.has(phaseKey)) return;
      skipButton.disabled = true;
      setStatus("Skipping current R2 phase...");
      try {
        await requestCurrentSweepPhaseSkip(phaseKey);
        setStatus("Skip requested. The current command will stop and the sweep will continue with the next phase.");
        loadR2Progress();
      } catch (error) {
        setStatus(error?.message || "Could not skip this R2 phase.");
        skipButton.disabled = false;
      }
      return;
    }
    const row = event.target instanceof Element ? event.target.closest("[data-owner-sweep-phase-toggle]") : null;
    if (!row || !r2Phases.contains(row)) return;
    toggleSweepPhaseDetails(row.dataset.ownerSweepPhaseToggle || "");
  });

  r2Phases?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target instanceof Element ? event.target.closest("[data-owner-sweep-phase-toggle]") : null;
    if (!row || !r2Phases.contains(row)) return;
    event.preventDefault();
    toggleSweepPhaseDetails(row.dataset.ownerSweepPhaseToggle || "");
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
