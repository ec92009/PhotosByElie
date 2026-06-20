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
  const visibilityPublicCountRoot = document.querySelector("[data-owner-visibility-public-count]");
  const visibilityLimboCountRoot = document.querySelector("[data-owner-visibility-limbo-count]");
  const visibilityApprovedCountRoot = document.querySelector("[data-owner-visibility-approved-count]");
  const visibilityBlockedReadyCountRoot = document.querySelector("[data-owner-visibility-blocked-ready-count], [data-owner-visibility-applied-hidden-count]");
  const visibilityR2ReadyCountRoot = document.querySelector("[data-owner-visibility-r2-ready-count]");
  const visibilityLimboCameraCountRoot = document.querySelector("[data-owner-visibility-limbo-camera-count]");
  const visibilityLimboAiCountRoot = document.querySelector("[data-owner-visibility-limbo-ai-count]");
  const visibilityLimboBarRoot = document.querySelector("[data-owner-visibility-limbo-bar]");
  const visibilityLimboCameraBar = document.querySelector("[data-owner-visibility-limbo-camera-bar]");
  const visibilityLimboAiBar = document.querySelector("[data-owner-visibility-limbo-ai-bar]");
  const visibilityNoteRoot = document.querySelector("[data-owner-visibility-note]");
  const blockedLocalCountRoot = document.querySelector("[data-owner-blocked-local-count]");
  const blockedPreviewCountRoot = document.querySelector("[data-owner-blocked-preview-count]");
  const basketStateNoteRoot = document.querySelector("[data-owner-basket-state-note]");
  const blockedPreviewProgressRoot = document.querySelector("[data-owner-blocked-preview-progress]");
  const blockedPreviewNoteRoot = document.querySelector("[data-owner-blocked-preview-note]");
  const burstCullPreviewButton = document.querySelector("[data-owner-burst-cull-preview]");
  const burstCullLoadButton = document.querySelector("[data-owner-burst-cull-load]");
  const burstCullGoButton = document.querySelector("[data-owner-burst-cull-go]");
  const burstCullPoolRoot = document.querySelector("[data-owner-burst-cull-pool]");
  const burstCullBurstsRoot = document.querySelector("[data-owner-burst-cull-bursts]");
  const burstCullKeptRoot = document.querySelector("[data-owner-burst-cull-kept]");
  const burstCullWasteRoot = document.querySelector("[data-owner-burst-cull-waste]");
  const burstCullStatusRoot = document.querySelector("[data-owner-burst-cull-status]");
  const burstCullOutputRoot = document.querySelector("[data-owner-burst-cull-output]");
  const syncCountryKeywordsButton = document.querySelector("[data-owner-sync-country-keywords]");
  const wipeHiddenR2Button = document.querySelector("[data-owner-wipe-hidden-r2]");
  const physicalProductsToggle = document.querySelector("[data-owner-physical-products]");
  const r2CoverageCard = document.querySelector("[data-owner-r2-coverage-card]");
  const r2CoverageSummary = document.querySelector("[data-owner-r2-coverage-summary]");
  const r2CoverageCounts = document.querySelector("[data-owner-r2-coverage-counts]");
  const r2CoverageMissing = document.querySelector("[data-owner-r2-coverage-missing]");
  const r2CoverageNote = document.querySelector("[data-owner-r2-coverage-note]");
  const r2FixButton = document.querySelector("[data-owner-r2-fix]");
  const importSourceSelect = document.querySelector("[data-owner-import-source-select]");
  const importSourcePinButton = document.querySelector("[data-owner-import-source-pin]");
  const importSourceReviewButton = document.querySelector("[data-owner-import-source-review]");
  const importSourceRemoveButton = document.querySelector("[data-owner-import-source-remove]");
  const importSourceDetails = document.querySelector("[data-owner-import-source-details]");
  const importSourcePathRoot = document.querySelector("[data-owner-import-source-path]");
  const importSourceLastUsedRoot = document.querySelector("[data-owner-import-source-last-used]");
  const importSourceStateRoot = document.querySelector("[data-owner-import-source-state]");
  const r2FillGapsButtons = [...document.querySelectorAll("[data-owner-r2-fill-gaps]")];
  const r2MaintenanceButtons = [...document.querySelectorAll("[data-owner-r2-maintenance]")];
  const r2Card = document.querySelector("[data-owner-r2-card]");
  const r2Summary = document.querySelector("[data-owner-r2-summary]");
  const r2Phases = document.querySelector("[data-owner-r2-phases]");
  const r2Counts = document.querySelector("[data-owner-r2-counts]");
  const applePhotosCard = document.querySelector("[data-owner-apple-photos-card]");
  const applePhotosAlbumSelect = document.querySelector("[data-owner-apple-photos-albums]");
  const applePhotosRefreshButton = document.querySelector("[data-owner-apple-photos-refresh]");
  const applePhotosPreflightButton = document.querySelector("[data-owner-apple-photos-preflight]");
  const applePhotosImportButton = document.querySelector("[data-owner-apple-photos-import]");
  const applePhotosStatus = document.querySelector("[data-owner-apple-photos-status]");
  const applePhotosCounts = document.querySelector("[data-owner-apple-photos-counts]");
  const applePhotosPreview = document.querySelector("[data-owner-apple-photos-preview]");
  const expandedSweepPhaseKeys = new Set();
  const priceListRoot = document.querySelector("[data-owner-price-list]");
  const publishPricesButton = document.querySelector("[data-owner-publish-prices]");
  const pricePublishStatus = document.querySelector("[data-owner-price-publish-status]");
  const pricePublishProgress = document.querySelector("[data-owner-price-publish-progress]");
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
  const titleKeywordReviewLink = document.querySelector("[data-owner-title-keyword-review-link]");
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
  const realEstateImportSourceSelect = document.querySelector("[data-owner-re-import-source-select]");
  const realEstateComputed = Object.fromEntries(
    [...document.querySelectorAll("[data-owner-re-computed]")]
      .map((field) => [field.dataset.ownerReComputed, field])
  );
  const accessUsersCard = document.querySelector("[data-owner-access-users-card]");
  const accessUserList = document.querySelector("[data-owner-access-user-list]");
  const accessUserForm = document.querySelector("[data-owner-access-user-form]");
  const accessUserEmailInput = document.querySelector("[data-owner-access-email]");
  const accessUserTierInput = document.querySelector("[data-owner-access-tier]");
  const accessUserRealEstateInput = document.querySelector("[data-owner-access-re-clients]");
  const accessUserNotesInput = document.querySelector("[data-owner-access-notes]");
  const accessUserPublishButton = document.querySelector("[data-owner-access-publish]");
  const accessUserStatus = document.querySelector("[data-owner-access-user-status]");
  const accessUserOwnerCountRoot = document.querySelector("[data-owner-access-owner-count]");
  const accessUserRealEstateCountRoot = document.querySelector("[data-owner-access-re-count]");
  const accessUserPendingCountRoot = document.querySelector("[data-owner-access-pending-count]");
  const refreshButtons = [...document.querySelectorAll("[data-owner-refresh]")];
  const productSettings = window.photosByElieProductSettings;
  const podStoreStateRoot = document.querySelector("[data-owner-pod-store-state]");
  const podSuppliersRoot = document.querySelector("[data-owner-pod-suppliers]");
  const podQualityTiersRoot = document.querySelector("[data-owner-pod-quality-tiers]");
  const podOptionsRoot = document.querySelector("[data-owner-pod-options]");
  const podSchemaRoot = document.querySelector("[data-owner-pod-schema]");
  let r2PollTimer = null;
  let r2RepairLogToken = "";
  let r2RepairActive = false;
  let r2GapFillActive = false;
  let r2MaintenanceActive = false;
  let activeR2MaintenanceKey = "";
  let importSourceOptions = [];
  let realEstateImportSourceOptions = [];
  let r2CoverageOk = false;
  let r2RepairLogSummary = null;
  let r2RepairLogTaskId = "";
  let r2PhaseRenderSnapshot = null;
  let applePhotosAlbums = [];
  let applePhotosBusy = false;
  let applePhotosLastOperation = null;
  let wasteDeleteActive = false;
  let wasteCleanupActive = false;
  let burstCullPreview = null;
  let burstCullBusy = false;
  let lastWasteCoverageRefreshAt = 0;
  let lastImportCoverageRefreshAt = 0;
  let latestR2ProgressTasks = [];
  let currentCostEstimate = null;
  let keywordBlacklistTerms = [];
  let importSourceDialogOpen = false;
  let realEstateImportSourceDialogOpen = false;
  let lastImportSourceValue = "new";
  let lastRealEstateImportSourceValue = "";
  let realEstateClients = [];
  let selectedRealEstateClientId = "";
  let realEstateBusy = false;
  let realEstateProgressTimer = null;
  let realEstateDraftSerial = 0;
  let accessUsers = [];
  let selectedAccessUserEmail = "";
  let accessUsersBusy = false;
  let pricePublishTimer = null;

  const setStatus = (message) => {
    if (status) status.textContent = message;
  };

  const setText = (element, value) => {
    if (element && element.textContent !== value) element.textContent = value;
  };

  const setHtml = (element, value) => {
    if (element && element.innerHTML !== value) element.innerHTML = value;
  };

  const setPricePublishStatus = (message) => {
    setText(pricePublishStatus, message);
  };

  const resetPricePublishStatus = () => {
    stopPricePublishPolling();
    renderPricePublishTask(null);
    if (publishPricesButton) publishPricesButton.disabled = false;
    setPricePublishStatus("Saved edits stay local until published.");
  };

  const summarizePricePublishFailure = (task = {}) => {
    const failedStep = (Array.isArray(task.steps) ? task.steps : []).find((step) => step.state === "failed");
    if (failedStep?.label) {
      const code = Number.isFinite(Number(failedStep.returnCode)) ? ` (exit ${failedStep.returnCode})` : "";
      return `${failedStep.label} failed${code}.`;
    }
    if (task.currentStep && task.currentStep !== "Failed") return `${task.currentStep} failed.`;
    return "Price publish failed.";
  };

  const renderPricePublishTask = (task = null) => {
    if (!pricePublishProgress) return;
    if (!task) {
      pricePublishProgress.hidden = true;
      setHtml(pricePublishProgress, "");
      return;
    }
    const steps = Array.isArray(task.steps) ? task.steps : [];
    const state = String(task.state || "");
    const current = task.currentStep || (state === "done" ? "Done" : "Queued");
    const rows = steps.map((step) => {
      const stepState = step.state === "done" ? "done" : step.state === "failed" ? "failed" : "running";
      const marker = stepState === "done" ? "Done" : stepState === "failed" ? "Failed" : "Running";
      const elapsed = Number(step.elapsedMs) > 0 ? ` ${Math.round(Number(step.elapsedMs) / 1000)}s` : "";
      return `
        <div class="owner-sweep-phase is-${escapeHtml(stepState)}">
          <strong>${escapeHtml(marker)}</strong>
          <span>${escapeHtml(step.label || "Publish step")}${escapeHtml(elapsed)}</span>
        </div>
      `;
    }).join("");
    const error = task.state === "failed"
      ? `<p class="owner-card-note">${escapeHtml(summarizePricePublishFailure(task))}</p>`
      : "";
    setHtml(pricePublishProgress, `
      <div class="owner-sweep-phase is-${escapeHtml(state || "queued")}">
        <strong>${escapeHtml(state === "done" ? "Complete" : state === "failed" ? "Failed" : "Publishing")}</strong>
        <span>${escapeHtml(current)}</span>
      </div>
      ${rows}
      ${error}
    `);
    pricePublishProgress.hidden = false;
  };

  const stopPricePublishPolling = () => {
    if (pricePublishTimer) window.clearInterval(pricePublishTimer);
    pricePublishTimer = null;
  };

  const updatePricePublishFromTask = (task = null) => {
    renderPricePublishTask(task);
    if (!task) return false;
    if (task.state === "done") {
      const workerVersion = task.workerVersionId ? ` Worker ${task.workerVersionId}.` : "";
      setStatus(`Prices published as v${task.newVersion}.`);
      setPricePublishStatus(`Published v${task.newVersion}.${workerVersion} GitHub Pages will update from the pushed commit.`);
      if (publishPricesButton) publishPricesButton.disabled = false;
      stopPricePublishPolling();
      return true;
    }
    if (task.state === "failed") {
      const message = summarizePricePublishFailure(task);
      setStatus(message);
      setPricePublishStatus(message);
      if (publishPricesButton) publishPricesButton.disabled = false;
      stopPricePublishPolling();
      return true;
    }
    setPricePublishStatus(`Publishing prices: ${task.currentStep || "working"} (${task.completed || 0}/${task.total || "?"}).`);
    return false;
  };

  const pollPricePublishTask = async (taskId) => {
    const response = await fetch(`/__photosbyelie/publish-prices-progress?task_id=${encodeURIComponent(taskId)}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 404) {
      throw new Error("Price publish progress needs the local Owner helper restarted.");
    }
    if (!response.ok || !payload.ok) throw new Error(payload.error || `Publish progress ${response.status}`);
    const task = (payload.tasks || [])[0] || null;
    updatePricePublishFromTask(task);
    return task;
  };

  const startPricePublishPolling = (taskId) => {
    stopPricePublishPolling();
    pricePublishTimer = window.setInterval(() => {
      pollPricePublishTask(taskId).catch((error) => {
        setPricePublishStatus(error?.message || "Could not load price publish progress.");
      });
    }, 1200);
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
    ["selected-folder", "Selected folder"],
    ["camera", "Camera"],
    ["apple-photo-albums", "Apple Photos"],
    ["leonardo", "AI"],
    ["real-estate", "RE"],
  ]);
  const SELECTED_IMPORT_DASHBOARD_PHASE_KEYS = ["selected-folder"];
  const FIXED_IMPORT_DASHBOARD_PHASE_KEYS = ["camera", "apple-photo-albums", "leonardo"];
  const IMPORT_MATRIX_STEPS = [
    ["master_uploaded", "Master"],
    ["triplets_created", "Triplets made"],
    ["triplets_uploaded", "Triplets up"],
    ["previews_created", "Previews made"],
    ["previews_uploaded", "Previews up"],
  ];
  const IMPORT_MATRIX_QUEUE_PREVIEW_LIMIT = 8;
  const IMPORT_MATRIX_RECENT_DONE_LIMIT = 6;
  const SWEEP_PHASES = [
    ["prepare", "Prepare workspace"],
    ["preflight", "Preflight import dependencies"],
    ["discard-start", "Double-check banned R2 cleanup"],
    ["import-cache", "Prepare import cache"],
    ["selected-folder", "Import selected folder"],
    ["camera", "Import Camera sources"],
    ["apple-photo-albums", "Import Apple Photos"],
    ["leonardo", "Import AI sources"],
    ["catalog", "Export catalog"],
    ["eligibility", "Force Camera eligibility"],
    ["worker", "Write worker catalog"],
    ["sidecar", "Write media sidecar"],
    ["gap-fill", "Fill in gaps"],
    ["private", "Fill in gaps", { optional: true }],
    ["discard-final", "Final banned R2 cleanup double-check"],
    ["storage", "Refresh storage estimate"],
    ["test", "Run tests"],
    ["validate", "Validate publish"],
    ["commit", "Commit and push"],
    ["coverage", "Recheck coverage"],
  ].map(([key, label, options]) => ({ key, label, ...(options || {}) }));
  const SWEEP_SKIPPABLE_KEYS = new Set([
    "discard-start",
    "selected-folder",
    "camera",
    "apple-photo-albums",
    "leonardo",
    "real-estate",
    "gap-fill",
    "private",
    "discard-final",
    "test",
    "validate",
  ]);
  const SWEEP_PHASE_ALIASES = new Map([
    ["catalog-blocked", "catalog"],
  ]);
  const R2_MAINTENANCE_LABELS = new Map([
    ["banned-cleanup", "Banned cleanup"],
    ["final-cleanup", "Final cleanup"],
    ["storage", "Storage estimate"],
    ["validate", "Validate publish"],
  ]);
  const normalizeSweepPhaseKey = (phaseKey = "") => (
    SWEEP_PHASE_ALIASES.get(String(phaseKey || "")) || String(phaseKey || "")
  );

  const renderOwnerPreviewState = () => {
    refreshCountsFromSource();
    refreshBlockedSyncPanel();
    renderPodCommerce();
    loadCostEstimate();
    loadKeywordBlacklist();
    loadTitleKeywordReviewCount();
    loadImportSources();
    renderR2Coverage(null);
  };

  const renderOwnerAvailability = (authState = ownerAuth?.state || {}, options = {}) => {
    if (!ownerAuth?.enabled) return;
    const available = authState.available === true;
    if (controls) controls.hidden = false;
    if (locked) locked.hidden = available;
    if (available) {
      setStatus("Owner controls unlocked on localhost.");
      refreshCountsFromSource();
      refreshBlockedSyncPanel();
      renderPodCommerce();
      loadImportSources();
      loadR2Coverage();
      loadCostEstimate();
      loadKeywordBlacklist();
      loadTitleKeywordReviewCount();
      loadRealEstateOwner();
      loadAccessUsers();
      startR2Polling();
      if (options.scrollToControls && controls) {
        window.requestAnimationFrame(() => {
          controls.scrollIntoView({ block: "start", behavior: "smooth" });
        });
      }
    } else {
      setText(locked, "Owner helper actions are offline. Read-only Owner dashboard is still available; use 127.0.0.1 or start scripts/local_server.py for actions.");
      setStatus("Owner helper actions are offline; dashboard shown read-only.");
      renderOwnerPreviewState();
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

  const originCount = (bucket, origin) => Number(bucket?.byOrigin?.[origin] ?? 0) || 0;

  const renderVisibilitySummary = (summary = null) => {
    const r2Public = summary?.r2ReadyPublic || summary?.publicApplied || {};
    const limbo = summary?.r2ReadyLimbo || {};
    const approved = summary?.r2ReadyApprovedNotApplied || summary?.approvedNotApplied || {};
    const blockedReady = summary?.blockedOrParkedReady || {};
    const approvedNotReady = summary?.approvedNotReady || {};
    const r2Ready = summary?.r2Ready || {};
    const limboCamera = originCount(limbo, "camera");
    const limboAi = originCount(limbo, "ai");
    const limboUnknown = originCount(limbo, "unknown");
    const limboTotal = Number(limbo.count ?? limbo.byOrigin?.total ?? (limboCamera + limboAi + limboUnknown)) || 0;
    const cameraPercent = limboTotal ? (limboCamera / limboTotal) * 100 : 0;
    const aiPercent = limboTotal ? (limboAi / limboTotal) * 100 : 0;
    setText(visibilityPublicCountRoot, formatCount(Number(r2Public.count || 0)));
    setText(visibilityLimboCountRoot, formatCount(limboTotal));
    setText(visibilityApprovedCountRoot, formatCount(Number(approved.count || 0)));
    setText(visibilityBlockedReadyCountRoot, formatCount(Number(blockedReady.count || 0)));
    setText(visibilityR2ReadyCountRoot, formatCount(Number(r2Ready.count || 0)));
    setText(visibilityLimboCameraCountRoot, formatCount(limboCamera));
    setText(visibilityLimboAiCountRoot, formatCount(limboAi));
    if (visibilityLimboCameraBar) visibilityLimboCameraBar.style.width = `${cameraPercent}%`;
    if (visibilityLimboAiBar) visibilityLimboAiBar.style.width = `${aiPercent}%`;
    if (visibilityLimboBarRoot) {
      visibilityLimboBarRoot.toggleAttribute("data-empty", limboTotal <= 0);
      visibilityLimboBarRoot.setAttribute(
        "aria-label",
        `Needs-review split: ${formatCount(limboCamera)} camera, ${formatCount(limboAi)} AI, ${formatCount(limboUnknown)} unknown.`
      );
    }
    if (visibilityNoteRoot) {
      const generatedAt = summary?.generatedAt ? new Date(summary.generatedAt) : null;
      const stamp = generatedAt && !Number.isNaN(generatedAt.getTime())
        ? ` Updated ${generatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`
        : "";
      const approvedOutsideGate = Number(approvedNotReady.count || 0) || 0;
      const outsideGateNote = approvedOutsideGate
        ? ` ${formatCount(approvedOutsideGate)} approved ${approvedOutsideGate === 1 ? "row is" : "rows are"} outside this R2-ready gate.`
        : "";
      visibilityNoteRoot.textContent = summary
        ? `R2 gate partitions preview-ready media into public, needs review, approved pending export, and parked/Waste Basket.${outsideGateNote}${stamp}`
        : "Visibility state requires the localhost Owner helper.";
    }
  };

  const loadVisibilitySummary = async () => {
    if (!visibilityNoteRoot) return null;
    try {
      const response = await fetch("/__photosbyelie/owner-visibility-summary", { cache: "no-store" });
      if (!response.ok) throw new Error("Visibility state requires the localhost Owner helper.");
      const payload = await response.json();
      if (payload?.ok === false) throw new Error(payload.error || "Visibility summary failed");
      renderVisibilitySummary(payload.summary || null);
      return payload.summary || null;
    } catch (error) {
      renderVisibilitySummary(null);
      visibilityNoteRoot.textContent = error?.message || "Visibility state requires the localhost Owner helper.";
      return null;
    }
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
  const reviewMediaLabel = (count) => `${formatCount(count)} ${Number(count) === 1 ? "media item" : "media items"}`;
  const titleKeywordReviewPhotoId = (item) => String(item?.photo_id || item?.photoId || "").trim();
  const savedTitleKeywordReviewIds = (payload) => {
    const ids = new Set();
    for (const key of ["approvals", "rejections", "blocked"]) {
      for (const item of payload?.[key] || []) {
        const photoId = titleKeywordReviewPhotoId(item);
        if (photoId) ids.add(photoId);
      }
    }
    return ids;
  };
  const staticTitleKeywordReviewCount = async (payload) => {
    const photos = Array.isArray(payload?.photos) ? payload.photos : [];
    const batchId = String(payload?.batch_id || payload?.batchId || "").trim();
    if (!photos.length || !batchId) return 0;
    const approvalsPath = `./assets/owner-actions/title-keyword-review-queue/approvals-${encodeURIComponent(batchId)}.json`;
    const approvalsHref = window.photosByElieVersionedHref?.(approvalsPath) || approvalsPath;
    const approvalsResponse = await fetch(approvalsHref, { cache: "no-store" }).catch(() => null);
    const approvalRecord = approvalsResponse?.ok ? await approvalsResponse.json().catch(() => ({})) : {};
    const savedIds = savedTitleKeywordReviewIds(approvalRecord);
    return photos.filter((photo) => {
      const photoId = titleKeywordReviewPhotoId(photo);
      return photoId && !savedIds.has(photoId);
    }).length;
  };
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
        <input type="number" min="0" step="0.01" inputmode="decimal" value="${escapeHtml(value)}"
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
        renderPricePublishTask(null);
        setPricePublishStatus("Saved locally. Press Publish prices to update checkout, deploy, commit, and push.");
      });
    });
  };

  const publishOwnerPrices = async () => {
    if (!publishPricesButton) return;
    publishPricesButton.disabled = true;
    setStatus("Publishing prices...");
    setPricePublishStatus("Starting price publish...");
    renderPricePublishTask({
      state: "queued",
      currentStep: "Contacting local Owner helper",
      completed: 0,
      total: 13,
      steps: [],
    });
    try {
      const overrides = productSettings?.priceOverrides?.() || {};
      const response = await fetch("/__photosbyelie/publish-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priceOverrides: overrides,
          commitMessage: "photosbyelie: publish owner price list",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 404) {
        throw new Error("Price publish needs the local Owner helper restarted; this page is talking to a server without the publish endpoint.");
      }
      if (!response.ok || !payload.ok) throw new Error(payload.error || `Publish prices ${response.status}`);
      const task = payload.task || null;
      if (!task?.id) throw new Error("Price publish did not return a task id.");
      updatePricePublishFromTask(task);
      startPricePublishPolling(task.id);
      await pollPricePublishTask(task.id);
    } catch (error) {
      setStatus(error?.message || "Could not publish prices.");
      setPricePublishStatus(error?.message || "Could not publish prices.");
      renderPricePublishTask({
        state: "failed",
        currentStep: "Could not start price publish",
        error: error?.message || "Could not publish prices.",
        completed: 0,
        total: 13,
        steps: [],
      });
      stopPricePublishPolling();
      publishPricesButton.disabled = false;
    }
  };

  const podAutomation = () => window.photosByEliePodAutomation || window.photosByElieProductCatalog?.podAutomation || {};
  const podSuppliers = () => window.photosByEliePodSuppliers || window.photosByElieProductCatalog?.podSuppliers || [];
  const podQualityTiers = () => window.photosByEliePodQualityTiers || window.photosByElieProductCatalog?.podQualityTiers || [];
  const podOptions = () => window.photosByEliePodOptions || window.photosByElieProductCatalog?.podOptions || [];
  const podMoney = (currency, value) => {
    if (value == null || value === "") return "quote";
    const amount = Number(value);
    if (!Number.isFinite(amount)) return "quote";
    const code = String(currency || "USD").toUpperCase();
    const symbol = code === "EUR" ? "€" : "$";
    return `${symbol}${amount.toFixed(amount % 1 ? 2 : 0)}`;
  };
  const podYesNo = (value) => value ? "yes" : "no";
  const renderPodCommerce = () => {
    const automation = podAutomation();
    const suppliers = podSuppliers();
    const qualityTiers = podQualityTiers();
    const options = podOptions();
    const productMap = new Map((window.photosByElieResolutions || []).map((option) => [option.id, option]));
    const frameMap = new Map((window.photosByElieFrameOptions || []).map((frame) => [frame.id, frame]));
    const supplierMap = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
    const physicalEnabled = productSettings?.physicalProductsEnabled?.() === true;
    const storeState = automation.storefrontEnabled === true
      ? "POD storefront flag is on in the catalog; do not deploy until checkout fulfillment is connected."
      : `Storefront flag is off. POD choices are visible only on localhost${physicalEnabled ? " with the local toggle enabled" : ""}.`;
    setText(podStoreStateRoot, storeState);

    if (podSuppliersRoot) {
      if (!suppliers.length) {
        setHtml(podSuppliersRoot, "<p class=\"owner-card-note\">No POD suppliers are configured.</p>");
      } else {
        setHtml(podSuppliersRoot, `
          <table class="owner-price-table owner-pod-table">
            <thead>
              <tr>
                <th scope="col">Supplier</th>
                <th scope="col">Role</th>
                <th scope="col">API</th>
                <th scope="col">Regions</th>
                <th scope="col">Automation</th>
                <th scope="col">Notes</th>
              </tr>
            </thead>
            <tbody>
              ${suppliers.map((supplier) => `
                <tr>
                  <th scope="row">${escapeHtml(supplier.label || supplier.id)}</th>
                  <td><span class="owner-pod-status">${escapeHtml(supplier.role || "")}</span><br>${escapeHtml(supplier.automationStatus || "")}</td>
                  <td>
                    <a href="${escapeHtml(supplier.apiDocsUrl || "#")}" target="_blank" rel="noreferrer">docs</a><br>
                    <code>${escapeHtml(supplier.apiBaseUrl || "")}</code>
                  </td>
                  <td>${escapeHtml((supplier.fulfillmentRegions || []).join(", "))}</td>
                  <td>
                    <strong>Quote:</strong> ${escapeHtml(supplier.quoteSupport || "")}<br>
                    <strong>Order:</strong> ${escapeHtml(supplier.orderSupport || "")}<br>
                    <strong>Hooks:</strong> ${escapeHtml(supplier.webhookSupport || "")}
                  </td>
                  <td>${escapeHtml(supplier.notes || "")}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        `);
      }
    }

    if (podQualityTiersRoot) {
      if (!qualityTiers.length) {
        setHtml(podQualityTiersRoot, "<p class=\"owner-card-note\">No POD quality tiers are configured.</p>");
      } else {
        setHtml(podQualityTiersRoot, `
          <table class="owner-price-table owner-pod-table owner-pod-tiers-table">
            <thead>
              <tr>
                <th scope="col">Tier</th>
                <th scope="col">Supplier</th>
                <th scope="col">Buyer position</th>
                <th scope="col">Print/frame profile</th>
                <th scope="col">Price stance</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              ${qualityTiers.map((tier) => {
                const supplier = supplierMap.get(tier.supplierId) || { label: tier.supplierId };
                return `
                  <tr>
                    <th scope="row">${escapeHtml(tier.label || tier.id)}</th>
                    <td>
                      ${escapeHtml(supplier.label || tier.supplierId)}<br>
                      <small>${escapeHtml(supplier.role || "")}</small>
                    </td>
                    <td>
                      ${escapeHtml(tier.buyerLabel || "")}<br>
                      <small>${escapeHtml(tier.qualityPosition || "")}</small>
                    </td>
                    <td>
                      <strong>Print:</strong> ${escapeHtml(tier.printProfile || "")}<br>
                      <strong>Frame:</strong> ${escapeHtml(tier.frameProfile || "")}
                    </td>
                    <td>${escapeHtml(tier.pricePosition || "")}</td>
                    <td>
                      <span class="owner-pod-status">${escapeHtml(tier.automationStatus || "")}</span><br>
                      <small>${escapeHtml(tier.notes || "")}</small>
                    </td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        `);
      }
    }

    if (podOptionsRoot) {
      if (!options.length) {
        setHtml(podOptionsRoot, "<p class=\"owner-card-note\">No POD supplier options are configured.</p>");
      } else {
        setHtml(podOptionsRoot, `
          <table class="owner-price-table owner-pod-table owner-pod-options-table">
            <thead>
              <tr>
                <th scope="col">Supplier</th>
                <th scope="col">Market</th>
                <th scope="col">Product</th>
                <th scope="col">Frame</th>
                <th scope="col">API IDs</th>
                <th scope="col">Supplier cost</th>
                <th scope="col">Automation</th>
                <th scope="col">Notes</th>
              </tr>
            </thead>
            <tbody>
              ${options.map((option) => {
                const product = productMap.get(option.productId) || { id: option.productId, label: option.productId };
                const frame = frameMap.get(option.frameId) || { id: option.frameId, label: option.frameId };
                const supplier = supplierMap.get(option.supplierId) || { label: option.supplierId };
                const ids = [
                  option.supplierProductId && `product ${option.supplierProductId}`,
                  option.supplierVariantId && `variant ${option.supplierVariantId}`,
                  option.supplierSku,
                ].filter(Boolean).join(" / ");
                return `
                  <tr>
                    <th scope="row">${escapeHtml(supplier.label || option.supplierId)}</th>
                    <td>${escapeHtml(String(option.marketRegion || "").toUpperCase())}</td>
                    <td>
                      ${escapeHtml(productLabel(product))}<br>
                      <small>${escapeHtml(option.supplierSize || product.detail || "")}</small>
                    </td>
                    <td>${escapeHtml(frame.label || option.frameId)}</td>
                    <td><code>${escapeHtml(ids || "quote lookup")}</code></td>
                    <td>
                      Item ${escapeHtml(podMoney(option.currency, option.supplierItemCost))}<br>
                      Ship ${escapeHtml(podMoney(option.currency, option.supplierShippingCost))}<br>
                      Total ${escapeHtml(podMoney(option.currency, option.supplierTotalCost))}
                    </td>
                    <td>
                      Quote ${escapeHtml(podYesNo(option.quoteSupported))}<br>
                      Order ${escapeHtml(podYesNo(option.orderSupported))}<br>
                      Account ${escapeHtml(podYesNo(option.requiresAccount))}
                    </td>
                    <td>${escapeHtml(option.notes || option.fulfillmentModel || "")}</td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        `);
      }
    }

    if (podSchemaRoot) {
      const printProducts = (window.photosByElieResolutions || []).filter((product) => product.type === "print").length;
      const schemaRows = [
        ["pod_settings", "setting_key, setting_value", "Storefront gate and supplier recommendation", Object.keys(automation).length],
        ["pod_suppliers", "supplier_id", "API capability and supplier role", suppliers.length],
        ["pod_quality_tiers", "quality_tier_id", "One-supplier routing for future buyer quality tiers", qualityTiers.length],
        ["pod_options", "pod_option_id", "Supplier SKU/variant mappings and cost rows", options.length],
        ["products", "product_id", "Customer-facing print sizes, still localhost-gated", printProducts],
        ["frame_options", "frame_id", "Frame choices shared across suppliers", (window.photosByElieFrameOptions || []).length],
      ];
      setHtml(podSchemaRoot, `
        <table class="owner-price-table owner-pod-table">
          <thead>
            <tr>
              <th scope="col">Table</th>
              <th scope="col">Key</th>
              <th scope="col">Purpose</th>
              <th scope="col">Rows</th>
            </tr>
          </thead>
          <tbody>
            ${schemaRows.map(([table, key, purpose, count]) => `
              <tr>
                <th scope="row"><code>${escapeHtml(table)}</code></th>
                <td><code>${escapeHtml(key)}</code></td>
                <td>${escapeHtml(purpose)}</td>
                <td>${escapeHtml(formatCount(count))}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `);
    }
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

  const loadTitleKeywordReviewCount = async () => {
    if (!titleKeywordReviewLink) return;
    titleKeywordReviewLink.textContent = "Review";
    try {
      const response = await fetch("/__photosbyelie/title-keyword-review-queue", { cache: "no-store" });
      if (!response.ok) throw new Error(`Title/keyword queue ${response.status}`);
      const payload = await response.json();
      const count = Number(
        payload?.selection?.total_count
        ?? payload?.selection?.visible_pending_count
        ?? payload?.selection?.sqlite_pending_count
        ?? (Array.isArray(payload?.photos) ? payload.photos.length : 0)
      );
      titleKeywordReviewLink.textContent = count > 0 ? `Review ${reviewMediaLabel(count)}` : "Review";
      titleKeywordReviewLink.setAttribute("aria-label", count > 0 ? `Review ${reviewMediaLabel(count)} for title and keyword cleanup` : "Review title and keyword proposals");
    } catch {
      try {
        const href = window.photosByElieVersionedHref?.("./assets/owner-actions/title-keyword-review-queue/latest.json") || "./assets/owner-actions/title-keyword-review-queue/latest.json";
        const response = await fetch(href, { cache: "no-store" });
        if (!response.ok) throw new Error(`Title/keyword queue view ${response.status}`);
        const payload = await response.json();
        const count = await staticTitleKeywordReviewCount(payload);
        titleKeywordReviewLink.textContent = count > 0 ? `Review ${reviewMediaLabel(count)}` : "Review";
        titleKeywordReviewLink.setAttribute("aria-label", count > 0 ? `Review ${reviewMediaLabel(count)} from the latest title and keyword batch` : "Review title and keyword proposals");
      } catch {
        titleKeywordReviewLink.textContent = "Review";
        titleKeywordReviewLink.setAttribute("aria-label", "Review title and keyword proposals");
      }
    }
  };

  const setRealEstateStatus = (message) => {
    if (realEstateStatus) realEstateStatus.textContent = message;
  };

  const setRealEstateBusy = (busy) => {
    realEstateBusy = busy;
    if (realEstateCard) {
      realEstateCard.querySelectorAll("button, input, textarea, select").forEach((control) => {
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
    const versionHref = (href) => window.photosByElieVersionedHref?.(href) || href;
    if (realEstateLocalLink) {
      realEstateLocalLink.href = versionHref(client?.localContextExists ? client.localReviewUrl : "./real-estate.html?logout=1");
      realEstateLocalLink.toggleAttribute("aria-disabled", !client?.localContextExists);
    }
    if (realEstatePublicLink) {
      realEstatePublicLink.href = versionHref(client?.publicContextExists ? client.publicReviewUrl : "./real-estate.html?logout=1");
      realEstatePublicLink.toggleAttribute("aria-disabled", !client?.publicContextExists);
    }
  };

  const realEstateClientLoginUrl = (client) => {
    const raw = client?.localReviewUrl || "./real-estate.html?logout=1";
    try {
      const url = new URL(raw, window.location.href);
      url.searchParams.delete("logout");
      return window.photosByElieVersionedHref?.(`${url.pathname}${url.search}${url.hash}`) || `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return window.photosByElieVersionedHref?.(raw.replace(/([?&])logout=1&?/, "$1").replace(/[?&]$/, "")) || raw;
    }
  };

  const unlockRealEstateClientSession = (client) => {
    const galleryKey = String(client?.galleryKey || realEstateConventionsFor(client).galleryKey || "").trim();
    const username = String(client?.username || client?.customer || client?.email || "").trim();
    if (!galleryKey || !username) return false;
    try {
      window.localStorage.setItem(`photosbyelie-real-estate-session-${galleryKey}`, JSON.stringify({
        galleryKey,
        username,
        unlocked: true,
        unlockedAt: new Date().toISOString(),
      }));
      return true;
    } catch {
      return false;
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
    renderRealEstateImportSourceOptions(realEstateImportSourceOptions);
    return selected;
  };

  const realEstateConventionsFor = (clientNameOrClient) => {
    const client = typeof clientNameOrClient === "object" && clientNameOrClient
      ? clientNameOrClient
      : null;
    const name = String(client ? client.customer : clientNameOrClient || "").trim();
    const defaultSourceRoot = name ? `/Volumes/Saturn/Pictures/RE/${name}` : "/Volumes/Saturn/Pictures/RE/<Client>";
    return {
      sourceRoot: String(client?.sourceRoot || "").trim() || defaultSourceRoot,
      username: name || "<Client>",
      slug: name || "<Client>",
      galleryKey: name ? `${name}-gallery` : "<Client>-gallery",
      galleryTitle: name || "<Client>",
      publicKeyPrefix: name ? `RE/${name}/previews` : "RE/<Client>/previews",
      privateKeyPrefix: name ? `RE/${name}/masters` : "RE/<Client>/masters",
    };
  };

  const updateRealEstateComputed = (clientNameOrClient) => {
    const conventions = realEstateConventionsFor(clientNameOrClient);
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
    sourceRoot: "",
  });

  const fillRealEstateForm = (client) => {
    if (!client || !realEstateForm) return;
    selectedRealEstateClientId = client.id || "";
    updateRealEstateComputed(client);
    updateRealEstateLinks(client && !client.isDraft ? client : null);
    renderRealEstateImportSourceOptions(realEstateImportSourceOptions);
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
        const availableProperties = client.availableProperties || [];
        const missingProperties = client.missingProperties || [];
        const discoveredText = availableProperties.length ? `${formatCount(availableProperties.length)} found` : "none found";
        const statusBits = client.isDraft
          ? ["draft", "not saved"]
          : [
              missingProperties.length
                ? `skipping: ${missingProperties.join(", ")}`
                : (client.sourceRootExists ? "source ok" : "source missing"),
              `discovered: ${discoveredText}`,
              client.publicContextExists ? "published" : "not published",
            ];
        const rowLabel = client.customer || client.id || "new client";
        return `
          <tr class="${active ? "is-active" : ""}" data-owner-re-client="${escapeHtml(client.id)}">
            <td>${realEstateCellInput(client, "customer", client.customer || "", { required: true, placeholder: "Client" })}</td>
            <td>${realEstateCellInput(client, "email", client.email || "", { type: "email", placeholder: "email@example.com" })}</td>
            <td>${realEstateCellInput(client, "accessCode", client.accessCode || "", { placeholder: "Optional" })}</td>
            <td>${realEstateCellInput(client, "maxItems", client.maxItems || 300, { type: "number", min: "1", step: "1", inputmode: "numeric" })}</td>
            <td>${realEstatePropertiesCell(client, properties)}</td>
            <td>${escapeHtml(formatCount(client.stats?.photoCount || 0))}</td>
            <td>${escapeHtml(statusBits.join(" / "))}</td>
            <td>
              <div class="owner-real-estate-row-actions">
                <button class="owner-real-estate-icon-button" type="button" data-owner-re-row-action="edit" data-owner-re-client-id="${escapeHtml(client.id)}" aria-label="Edit ${escapeHtml(rowLabel)}" title="Edit client">${realEstateRowIcon("pen")}</button>
                <button class="owner-real-estate-icon-button is-danger" type="button" data-owner-re-row-action="delete" data-owner-re-client-id="${escapeHtml(client.id)}" aria-label="Delete ${escapeHtml(rowLabel)}" title="Delete client">${realEstateRowIcon("trash")}</button>
                <button class="owner-real-estate-login-button" type="button" data-owner-re-row-action="login" data-owner-re-client-id="${escapeHtml(client.id)}" aria-label="Open login for ${escapeHtml(rowLabel)}" title="Open client login"${client.localContextExists && !client.isDraft ? "" : " disabled"}>Login</button>
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
      loadRealEstateImportSources();
      const selected = selectedRealEstateClient();
      setRealEstateStatus(selected
        ? `${selected.customer}: ${formatCount(selected.stats?.photoCount || 0)} photos, ${selected.passwordSet ? "legacy code set" : "Google access ready"}.`
        : "No real estate clients configured.");
      renderRealEstateOutput("");
    } catch (error) {
      setRealEstateStatus(error?.message || "Could not load real estate clients.");
    }
  };

  const setAccessUserStatus = (message) => {
    if (accessUserStatus) accessUserStatus.textContent = message;
  };

  const setAccessUsersBusy = (busy) => {
    accessUsersBusy = busy;
    if (accessUsersCard) {
      accessUsersCard.querySelectorAll("button, input, textarea, select").forEach((control) => {
        control.disabled = busy;
      });
    }
    setRefreshBusy("access-users", busy);
  };

  const parseAccessRealEstateClients = (value) => String(value || "")
    .split(/\r?\n|,|;/)
    .map((client) => client.trim())
    .filter(Boolean);

  const accessUserByEmail = (email) => {
    const target = String(email || "").trim().toLowerCase();
    return accessUsers.find((user) => user.email === target) || null;
  };

  const fillAccessUserForm = (user = {}) => {
    selectedAccessUserEmail = user.email || selectedAccessUserEmail || "";
    if (accessUserEmailInput) accessUserEmailInput.value = user.email || "";
    if (accessUserTierInput) accessUserTierInput.value = user.tier || "user";
    if (accessUserRealEstateInput) accessUserRealEstateInput.value = (user.realEstateClients || []).join("\n");
    if (accessUserNotesInput) accessUserNotesInput.value = user.notes || "";
  };

  const accessUserPayloadFromForm = () => ({
    email: accessUserEmailInput?.value || "",
    tier: accessUserTierInput?.value || "user",
    realEstateClients: parseAccessRealEstateClients(accessUserRealEstateInput?.value || ""),
    notes: accessUserNotesInput?.value || "",
  });

  const accessUserStatusLabel = (user) => {
    if (user.publishStatus === "synced") return "synced";
    if (user.publishStatus === "failed") return `failed: ${user.publishError || "sync failed"}`;
    return "pending";
  };

  const renderAccessUsers = () => {
    if (!accessUsersCard) return;
    const counts = accessUsers.reduce((memo, user) => {
      if (user.tier === "owner") memo.owners += 1;
      if (user.tier === "re_client" || user.realEstateClients?.length) memo.realEstateClients += 1;
      if (user.publishStatus === "pending" || user.publishStatus === "failed") memo.pending += 1;
      return memo;
    }, { owners: 0, realEstateClients: 0, pending: 0 });
    setText(accessUserOwnerCountRoot, formatCount(counts.owners));
    setText(accessUserRealEstateCountRoot, formatCount(counts.realEstateClients));
    setText(accessUserPendingCountRoot, formatCount(counts.pending));
    if (accessUserList) {
      accessUserList.innerHTML = accessUsers.length ? accessUsers.map((user) => {
        const active = user.email === selectedAccessUserEmail;
        const label = user.email || "access user";
        return `
          <tr class="${active ? "is-active" : ""}" data-owner-access-email="${escapeHtml(user.email || "")}">
            <td><strong>${escapeHtml(user.email || "")}</strong><small>${escapeHtml(user.grantedBy || "")}</small></td>
            <td>${escapeHtml(user.tier || "user")}</td>
            <td>${escapeHtml((user.realEstateClients || []).join(", ") || "none")}</td>
            <td>${escapeHtml(accessUserStatusLabel(user))}</td>
            <td>
              <div class="owner-real-estate-row-actions">
                <button class="owner-real-estate-icon-button" type="button" data-owner-access-action="edit" data-owner-access-email="${escapeHtml(user.email || "")}" aria-label="Edit ${escapeHtml(label)}" title="Edit role">${realEstateRowIcon("pen")}</button>
                <button class="owner-real-estate-login-button" type="button" data-owner-access-action="publish" data-owner-access-email="${escapeHtml(user.email || "")}" aria-label="Sync ${escapeHtml(label)}" title="Sync to Worker KV">Sync</button>
              </div>
            </td>
          </tr>
        `;
      }).join("") : `<tr><td colspan="5">No cloud roles saved yet.</td></tr>`;
    }
    fillAccessUserForm(accessUserByEmail(selectedAccessUserEmail) || {});
  };

  const loadAccessUsers = async () => {
    if (!accessUsersCard) return;
    setAccessUserStatus("Loading cloud roles...");
    try {
      const response = await fetch("/__photosbyelie/access-users", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Could not load cloud roles.");
      accessUsers = Array.isArray(payload.users) ? payload.users : [];
      if (!selectedAccessUserEmail || !accessUserByEmail(selectedAccessUserEmail)) {
        selectedAccessUserEmail = accessUsers[0]?.email || "";
      }
      renderAccessUsers();
      const counts = payload.counts || {};
      setAccessUserStatus(`${formatCount(counts.total || accessUsers.length)} users. KV ${payload.kv?.binding || "binding"} / ${payload.kv?.prefix || "prefix"}.`);
    } catch (error) {
      accessUsers = [];
      renderAccessUsers();
      setAccessUserStatus(error?.message || "Cloud role admin is unavailable.");
    }
  };

  const postAccessUserAction = async (body) => {
    const response = await fetch("/__photosbyelie/access-users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Cloud role action failed.");
    return payload;
  };

  const saveAccessUser = async (publish = false) => {
    if (accessUsersBusy) return;
    const user = accessUserPayloadFromForm();
    if (!String(user.email || "").trim()) {
      setAccessUserStatus("Email is required.");
      accessUserEmailInput?.focus();
      return;
    }
    const authorized = await ownerAuth?.requireAuth?.("Start the local Photos By Elie server on David to change cloud roles.");
    if (ownerAuth?.enabled && !authorized) return;
    setAccessUsersBusy(true);
    setAccessUserStatus(publish ? `Saving and syncing ${user.email}...` : `Saving ${user.email}...`);
    try {
      const payload = await postAccessUserAction({ action: "save-user", user, publish });
      accessUsers = Array.isArray(payload.users) ? payload.users : accessUsers;
      selectedAccessUserEmail = payload.user?.email || String(user.email || "").trim().toLowerCase();
      renderAccessUsers();
      const syncText = payload.publish ? (payload.publish.ok ? " Synced to Worker KV." : ` Sync failed: ${payload.publish.error}`) : "";
      setAccessUserStatus(`${selectedAccessUserEmail} saved.${syncText}`);
    } catch (error) {
      setAccessUserStatus(error?.message || "Could not save cloud role.");
    } finally {
      setAccessUsersBusy(false);
    }
  };

  const publishAccessUser = async (email) => {
    if (accessUsersBusy) return;
    const target = String(email || "").trim().toLowerCase();
    if (!target) return;
    const authorized = await ownerAuth?.requireAuth?.("Start the local Photos By Elie server on David to sync cloud roles.");
    if (ownerAuth?.enabled && !authorized) return;
    setAccessUsersBusy(true);
    setAccessUserStatus(`Syncing ${target}...`);
    try {
      const payload = await postAccessUserAction({ action: "publish-user", email: target });
      accessUsers = Array.isArray(payload.users) ? payload.users : accessUsers;
      selectedAccessUserEmail = target;
      renderAccessUsers();
      setAccessUserStatus(payload.publish?.ok ? `${target} synced to Worker KV.` : `${target} saved, but sync failed: ${payload.publish?.error || "unknown error"}`);
    } catch (error) {
      setAccessUserStatus(error?.message || "Could not sync cloud role.");
    } finally {
      setAccessUsersBusy(false);
    }
  };

  const realEstateClientPayload = (client) => ({
    id: client?.isDraft ? "" : (client?.id || ""),
    customer: client?.customer || "",
    email: client?.email || "",
    accessCode: client?.accessCode || "",
    properties: realEstatePropertiesFor(client).join("\n"),
    maxItems: client?.maxItems || 300,
    sourceRoot: client?.sourceRoot || "",
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

  const realEstateImportProgressMessage = (clientName, progress = {}, fallbackSourceRoot = "") => {
    const total = Number(progress.total || 0);
    const completed = Number(progress.completed || 0);
    const skipped = Array.isArray(progress.skippedProperties) ? progress.skippedProperties : [];
    const currentAlbum = progress.album ? ` (${progress.album})` : "";
    const skippedText = skipped.length ? ` Skipping missing: ${skipped.join(", ")}.` : "";
    const sourceRoot = String(progress.sourceRoot || fallbackSourceRoot || `/Volumes/Saturn/Pictures/RE/${clientName}`).trim();
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

  const startRealEstateImportProgress = (operationId, clientName, sourceRoot = "") => {
    stopRealEstateImportProgress();
    if (!operationId) return;
    const refresh = async () => {
      try {
        const response = await fetch(`/__photosbyelie/real-estate-import-progress?operation_id=${encodeURIComponent(operationId)}`, { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        const progress = payload?.progress;
        if (!response.ok || !progress) return;
        setRealEstateStatus(realEstateImportProgressMessage(clientName, progress, sourceRoot));
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
    if (!clientName) {
      setRealEstateStatus("Client name is required before autosave.");
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
      setRealEstateStatus("Finish the draft client. It saves automatically after the client name is filled.");
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
    setRealEstateStatus("New client draft. Fill client name first; each field saves when you leave it.");
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

  const openRealEstateClientLogin = (clientId) => {
    const client = realEstateClients.find((item) => item.id === clientId);
    if (!client || client.isDraft) {
      setRealEstateStatus("Save this real estate client before opening login.");
      return;
    }
    if (!client.localContextExists || !client.localReviewUrl) {
      setRealEstateStatus(`${client.customer || "Client"} needs a local context before login can open. Press RE import or Publish context first.`);
      return;
    }
    if (!unlockRealEstateClientSession(client)) {
      setRealEstateStatus(`${client.customer || "Client"} needs a gallery key before direct login can open.`);
      return;
    }
    markRealEstateRowSelected(client.id);
    renderRealEstateClients();
    setRealEstateStatus(`Opening ${client.customer || client.id} review...`);
    window.open(realEstateClientLoginUrl(client), "_blank", "noopener");
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
      setRealEstateStatus("Finish the draft client before running client actions.");
      return;
    }
    if (action === "upload-client") {
      const ok = window.confirm("Upload public previews and private masters for this real estate client?");
      if (!ok) return;
    }
    let realEstateImportSource = null;
    if (action === "import-client") {
      realEstateImportSource = await realEstateImportSourceForRun(selected);
      if (!realEstateImportSource?.path) return;
    }
    setRealEstateBusy(true);
    const labels = {
      "import-client": realEstateImportSource?.name
        ? `Importing previews from ${realEstateImportSource.name}...`
        : "Importing previews...",
      "discover-properties": "Discovering property folders...",
      "publish-client": "Publishing context...",
      "upload-dry-run": "Checking upload inventory...",
      "upload-client": "Uploading masters and previews...",
      "worker-secret": "Preparing Worker secret...",
    };
    setRealEstateStatus(labels[action] || "Running real estate action...");
    const operationId = action === "import-client"
      ? `re-import-${selected.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`
      : "";
    if (operationId) startRealEstateImportProgress(operationId, selected.customer || selected.id, realEstateImportSource?.path || "");
    try {
      const payload = await postRealEstateOwnerAction({
        action,
        id: selected.id,
        operationId,
        ...(realEstateImportSource?.path ? { sourceRoot: realEstateImportSource.path } : {}),
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
            ? `${clientName} RE previews imported from ${realEstateImportSource?.name || "selected source"}: ${formatCount(importProgress.completed || 0)} / ${formatCount(importProgress.total || 0)} media.${skipped.length ? ` Skipped missing: ${skipped.join(", ")}.` : ""}`
            : `${clientName} previews imported.`,
          "discover-properties": `${clientName} properties updated from ${formatCount(payload.properties?.length || 0)} discovered folders.`,
          "publish-client": `${clientName} context published.`,
          "upload-dry-run": `${clientName} upload dry run complete.`,
          "upload-client": `${clientName} upload complete.`,
        };
        setRealEstateStatus(doneLabels[action] || "Real estate action complete.");
        if (action === "import-client") loadRealEstateImportSources();
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

  const blockedR2ArtifactCountFromCoverage = () => (window.photosByElieR2Coverage?.rows || [])
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
        blockedPreviewNoteRoot.textContent = "R2 purge is in progress: the undo queue is already cleared, tombstones are preserved, and R2 is deleting up to 6 artifacts per photo: 2 public previews, 1 private master, and 3 private JPG renders.";
      }
      return;
    }
    const blockedR2Artifacts = blockedR2ArtifactCountFromCoverage();
    if (blockedPreviewCountRoot) blockedPreviewCountRoot.textContent = formatCount(blockedR2Artifacts);
    if (blockedPreviewNoteRoot) {
      blockedPreviewNoteRoot.textContent = blockedR2Artifacts
        ? `${formatCount(blockedR2Artifacts)} R2 artifacts are still present. Each photo can have up to 6: 2 public previews, 1 private master, and 3 private JPG renders.`
        : "Basketed photos no longer have R2 media artifacts.";
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

  const setBurstCullStatus = (message) => {
    if (burstCullStatusRoot) burstCullStatusRoot.textContent = message;
  };

  const setBurstCullBusy = (busy) => {
    burstCullBusy = busy;
    [burstCullPreviewButton, burstCullLoadButton, burstCullGoButton].forEach((button) => {
      if (!button) return;
      button.disabled = busy || (button === burstCullGoButton && !(burstCullPreview?.counts?.waste_basket_moves > 0));
    });
  };

  const burstCullProtectedIds = () => {
    const ids = new Set();
    const add = (value) => {
      const text = String(value || "").trim();
      if (text) ids.add(text);
    };
    try {
      (window.photosByElieLiked?.read?.() || []).forEach((item) => add(item.photoId || item.id || item));
      (window.photosByElieBasket?.read?.() || []).forEach((item) => add(item.photoId || item.id || item));
      const checkout = JSON.parse(window.localStorage.getItem("photosbyelie-mock-checkout") || "{}");
      (checkout?.lastResponse?.order?.items || checkout?.order?.items || []).forEach((item) => {
        add(item.photoId || item.photo_id || item.id);
      });
    } catch {
      // Client-side protection is best-effort; server-side Owner protections still apply.
    }
    return [...ids];
  };

  const renderBurstCullPreview = (payload = null) => {
    burstCullPreview = payload;
    const counts = payload?.counts || {};
    const kept = Number(counts.survivors || 0) + Number(counts.non_burst_kept || 0);
    setText(burstCullPoolRoot, formatCount(counts.pool || 0));
    setText(burstCullBurstsRoot, formatCount(counts.burst_groups || 0));
    setText(burstCullKeptRoot, formatCount(kept));
    setText(burstCullWasteRoot, formatCount(counts.waste_basket_moves || 0));
    if (burstCullGoButton) burstCullGoButton.disabled = burstCullBusy || !(Number(counts.waste_basket_moves || 0) > 0);
    if (!burstCullOutputRoot) return;
    if (!payload) {
      burstCullOutputRoot.hidden = true;
      burstCullOutputRoot.innerHTML = "";
      return;
    }
    const groups = Array.isArray(payload.burst_groups) ? payload.burst_groups : [];
    const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    const protectedRows = Array.isArray(payload.protected) ? payload.protected : [];
    const groupRows = groups.slice(0, 80).map((group) => `
      <tr>
        <td>${escapeHtml(group.burst_id)}</td>
        <td>${formatCount(group.size)}</td>
        <td>${escapeHtml(group.start || "")}</td>
        <td>${escapeHtml((group.survivor_ids || []).join(", "))}</td>
        <td>${escapeHtml((group.reject_ids || []).join(", "))}</td>
      </tr>
    `).join("");
    const candidateRows = candidates.map((item) => `
      <tr>
        <td>${escapeHtml(item.photo_id)}</td>
        <td>${escapeHtml(item.captured_at || "")}</td>
        <td>${escapeHtml(item.burst_id || "non-burst")}</td>
        <td>${escapeHtml(item.burst_position ? `${item.burst_position}/${item.burst_size}` : "")}</td>
        <td><span class="owner-burst-cull-outcome is-${escapeHtml(item.outcome || "keep")}">${escapeHtml(item.outcome || "keep")}</span></td>
      </tr>
    `).join("");
    const protectedRowsHtml = protectedRows.slice(0, 160).map((item) => `
      <tr>
        <td>${escapeHtml(item.photo_id)}</td>
        <td>${escapeHtml(item.captured_at || "")}</td>
        <td>${escapeHtml(item.reason || "protected")}</td>
      </tr>
    `).join("");
    burstCullOutputRoot.innerHTML = `
      <div class="owner-burst-cull-section">
        <h3>Burst groups</h3>
        <p>${formatCount(groups.length)} burst groups. ${groups.length > 80 ? "Showing first 80 groups." : "Showing all groups."}</p>
        <div class="owner-burst-cull-table-wrap">
          <table class="owner-burst-cull-table">
            <thead><tr><th>Group</th><th>Size</th><th>Start</th><th>Survivors</th><th>Waste Basket</th></tr></thead>
            <tbody>${groupRows || `<tr><td colspan="5">No burst groups detected.</td></tr>`}</tbody>
          </table>
        </div>
      </div>
      <div class="owner-burst-cull-section">
        <h3>Candidate outcomes</h3>
        <p>${formatCount(candidates.length)} eligible candidates including non-bursts.</p>
        <div class="owner-burst-cull-table-wrap">
          <table class="owner-burst-cull-table">
            <thead><tr><th>Photo</th><th>Capture</th><th>Group</th><th>Position</th><th>Outcome</th></tr></thead>
            <tbody>${candidateRows || `<tr><td colspan="5">No eligible candidates.</td></tr>`}</tbody>
          </table>
        </div>
      </div>
      <div class="owner-burst-cull-section">
        <h3>Protected skips</h3>
        <p>${formatCount(protectedRows.length)} protected or ineligible rows. ${protectedRows.length > 160 ? "Showing first 160 skips." : "Showing all skips."}</p>
        <div class="owner-burst-cull-table-wrap">
          <table class="owner-burst-cull-table">
            <thead><tr><th>Photo</th><th>Capture</th><th>Reason</th></tr></thead>
            <tbody>${protectedRowsHtml || `<tr><td colspan="3">No protected skips.</td></tr>`}</tbody>
          </table>
        </div>
      </div>
    `;
    burstCullOutputRoot.hidden = false;
  };

  const loadBurstCullPreview = async () => {
    const authorized = await ownerAuth?.requireAuth?.("Start the local Photos By Elie server to preview burst culling.");
    if (ownerAuth?.enabled && !authorized) throw new Error("Owner helper server required.");
    setBurstCullBusy(true);
    setBurstCullStatus("Loading conservative burst cull preview...");
    try {
      const response = await fetch("/__photosbyelie/owner-burst-cull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ protected_ids: burstCullProtectedIds() }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Could not load burst cull preview.");
      renderBurstCullPreview(payload);
      const counts = payload.counts || {};
      setBurstCullStatus(`${formatCount(counts.pool || 0)} in-system rows checked: ${formatCount(counts.burst_groups || 0)} bursts, ${formatCount(counts.waste_basket_moves || 0)} proposed Waste Basket moves, ${formatCount(counts.protected_skips || 0)} protected skips.`);
      return payload;
    } finally {
      setBurstCullBusy(false);
    }
  };

  const runBurstCull = async () => {
    if (!burstCullPreview?.counts) await loadBurstCullPreview();
    const moves = Number(burstCullPreview?.counts?.waste_basket_moves || 0);
    if (!moves) {
      setBurstCullStatus("No burst rejects are proposed.");
      return;
    }
    const ok = window.confirm(`Move ${formatCount(moves)} conservative burst rejects to Waste Basket? Survivors and non-bursts stay unapproved; source files and R2 media are not deleted.`);
    if (!ok) return;
    setBurstCullBusy(true);
    setBurstCullStatus("Moving proposed burst rejects to Waste Basket...");
    try {
      const response = await fetch("/__photosbyelie/owner-burst-cull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true, protected_ids: burstCullProtectedIds() }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Could not run burst cull.");
      renderBurstCullPreview(payload);
      const counts = payload.counts || {};
      setBurstCullStatus(`Burst cull complete: ${formatCount(counts.waste_basket_moves || 0)} moved to Waste Basket, ${formatCount(counts.survivors || 0)} survivors, ${formatCount(counts.non_burst_kept || 0)} non-bursts kept, ${formatCount(counts.failures || 0)} failures.`);
      setStatus(`Conservative burst cull complete: ${formatCount(counts.waste_basket_moves || 0)} Waste Basket moves.`);
      refreshDiscardedCount();
      loadVisibilitySummary();
    } finally {
      setBurstCullBusy(false);
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
    await loadVisibilitySummary();
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
    if (r2CoverageOk) return "Current catalog coverage is up to date; choose an import source before starting new files.";
    const gaps = r2GapCounts();
    if (gaps.photos) {
      return `${formatCount(gaps.photos)} incomplete photos: ${formatCount(gaps.masters)} need masters, ${formatCount(gaps.triplets)} need private JPG triplets, ${formatCount(gaps.previews)} need public previews.`;
    }
    const missing = coverageRepairGapSummary();
    return missing ? `Coverage still has gaps: ${missing}.` : "Coverage still has gaps.";
  };

  const folderNameFromPath = (path) => String(path || "").split(/[\\/]/).filter(Boolean).at(-1) || String(path || "");

  const importSourceByPath = (path) => importSourceOptions.find((source) => source.path === path) || null;

  const formatImportSourceTime = (value) => {
    const date = value ? new Date(value) : null;
    if (!date || !Number.isFinite(date.getTime())) return "Never";
    return date.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const importSourceStateText = (source) => {
    if (!source) return "";
    const parts = [];
    parts.push(source.exists ? "Available" : "Missing");
    if (source.pinned) parts.push("Pinned");
    if (source.reviewRequired) parts.push("Legacy review needed");
    if (source.useCount) parts.push(`${formatCount(source.useCount)} run${Number(source.useCount) === 1 ? "" : "s"}`);
    return parts.join(" · ");
  };

  const renderImportSourceDetails = () => {
    if (!importSourceSelect || !importSourceDetails) return;
    const choice = importSourceSelect.value || "new";
    const source = importSourceByPath(choice);
    const hasSource = Boolean(source);
    importSourceDetails.hidden = !hasSource;
    setText(importSourcePathRoot, hasSource ? source.path : "");
    setText(importSourceLastUsedRoot, hasSource ? formatImportSourceTime(source.lastUsedAt) : "");
    setText(importSourceStateRoot, hasSource ? importSourceStateText(source) : "");
    if (importSourcePinButton) {
      importSourcePinButton.disabled = !hasSource;
      importSourcePinButton.textContent = source?.pinned ? "Unpin" : "Pin";
      importSourcePinButton.title = hasSource
        ? (source.pinned ? "Remove this source from favorites" : "Pin this source as a favorite")
        : "Choose a remembered source to pin";
    }
    if (importSourceReviewButton) {
      importSourceReviewButton.hidden = !source?.reviewRequired;
      importSourceReviewButton.disabled = !source?.reviewRequired;
      importSourceReviewButton.title = source?.reviewRequired
        ? "Mark this legacy remembered folder as reviewed"
        : "";
    }
    if (importSourceRemoveButton) {
      importSourceRemoveButton.disabled = !hasSource;
      importSourceRemoveButton.title = hasSource
        ? "Remove this remembered source folder from Owner.sqlite history"
        : "Choose a remembered source to remove";
    }
  };

  const importSourceChoiceLabel = () => {
    const value = importSourceSelect?.value || "new";
    if (value === "all") return "All Expo source folders";
    if (value === "new") return "New folder";
    const source = importSourceByPath(value);
    const optionLabel = importSourceSelect?.selectedOptions?.[0]?.textContent?.trim() || "";
    return source?.label || optionLabel || folderNameFromPath(value) || value;
  };

  const selectImportSourceFolder = (folder = {}) => {
    if (!importSourceSelect) return null;
    const path = String(folder.path || "").trim();
    if (!path) return null;
    const label = String(folder.name || folder.label || "").trim() || folderNameFromPath(path) || path;
    const existingOption = [...importSourceSelect.options].find((option) => option.value === path);
    if (!existingOption) {
      const option = document.createElement("option");
      option.value = path;
      option.textContent = label;
      option.title = path;
      const allOption = [...importSourceSelect.options].find((item) => item.value === "all");
      importSourceSelect.insertBefore(option, allOption || null);
    } else {
      existingOption.textContent = existingOption.textContent || label;
      existingOption.title = existingOption.title || path;
    }
    if (!importSourceByPath(path)) {
      importSourceOptions = [
        { path, label, exists: true, discovered: false },
        ...importSourceOptions.filter((source) => source.path !== path),
      ];
    }
    importSourceSelect.value = path;
    lastImportSourceValue = path;
    syncR2ActionButtons();
    renderImportSourceDetails();
    if (!latestR2ProgressTasks.some((task) => ["repair", "gap-fill", "maintenance"].includes(task?.operation))) {
      renderImportDashboardIdle();
    }
    return { path, name: label };
  };

  const realEstateImportSourceByPath = (path) => (
    realEstateImportSourceOptions.find((source) => source.path === path) || null
  );

  const currentRealEstateSourceRoot = (client = selectedRealEstateClient()) => {
    if (!client || client.isDraft) return "";
    return String(client.sourceRoot || realEstateConventionsFor(client).sourceRoot || "").trim();
  };

  const realEstateImportSourceLabel = (path) => {
    const source = realEstateImportSourceByPath(path);
    const optionLabel = realEstateImportSourceSelect?.selectedOptions?.[0]?.textContent?.trim() || "";
    return source?.label || optionLabel || folderNameFromPath(path) || path;
  };

  const selectRealEstateImportSourceFolder = (folder = {}) => {
    if (!realEstateImportSourceSelect) return null;
    const path = String(folder.path || "").trim();
    if (!path) return null;
    const label = String(folder.name || folder.label || "").trim() || folderNameFromPath(path) || path;
    const existingOption = [...realEstateImportSourceSelect.options].find((option) => option.value === path);
    if (!existingOption) {
      const option = document.createElement("option");
      option.value = path;
      option.textContent = label;
      option.title = path;
      const newOption = [...realEstateImportSourceSelect.options].find((item) => item.value === "new");
      realEstateImportSourceSelect.insertBefore(option, newOption || null);
    } else {
      existingOption.textContent = existingOption.textContent || label;
      existingOption.title = existingOption.title || path;
    }
    if (!realEstateImportSourceByPath(path)) {
      realEstateImportSourceOptions = [
        { path, label, exists: true, discovered: false },
        ...realEstateImportSourceOptions.filter((source) => source.path !== path),
      ];
    }
    realEstateImportSourceSelect.value = path;
    lastRealEstateImportSourceValue = path;
    return { path, name: label };
  };

  const renderRealEstateImportSourceOptions = (sources = []) => {
    if (!realEstateImportSourceSelect) return;
    const selected = selectedRealEstateClient();
    const previous = realEstateImportSourceSelect.value || lastRealEstateImportSourceValue;
    realEstateImportSourceOptions = sources
      .map((source) => ({
        path: String(source?.path || "").trim(),
        label: String(source?.label || "").trim(),
        exists: source?.exists !== false,
        discovered: Boolean(source?.discovered),
        pinned: Boolean(source?.pinned),
        reviewRequired: Boolean(source?.reviewRequired),
        reviewCompletedAt: String(source?.reviewCompletedAt || ""),
        lastUsedAt: String(source?.lastUsedAt || ""),
        useCount: Number(source?.useCount || 0),
      }))
      .filter((source) => source.path);
    realEstateImportSourceSelect.textContent = "";
    const addOption = (value, label, title = "") => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      if (title) option.title = title;
      realEstateImportSourceSelect.append(option);
    };
    const clientSourceRoot = currentRealEstateSourceRoot(selected);
    if (clientSourceRoot) {
      addOption(clientSourceRoot, `Current: ${folderNameFromPath(clientSourceRoot)}`, clientSourceRoot);
    }
    realEstateImportSourceOptions.forEach((source) => {
      if (source.path === clientSourceRoot) return;
      const label = `${source.label || source.path}${source.exists ? "" : " (missing)"}`;
      addOption(source.path, label, source.path);
    });
    addOption("new", "New...");
    const values = new Set([...realEstateImportSourceSelect.options].map((option) => option.value));
    const preferredPrevious = previous === "new" && clientSourceRoot ? "" : previous;
    realEstateImportSourceSelect.value = values.has(preferredPrevious)
      ? previous
      : (clientSourceRoot || realEstateImportSourceOptions[0]?.path || "new");
    lastRealEstateImportSourceValue = realEstateImportSourceSelect.value;
    realEstateImportSourceSelect.disabled = realEstateBusy || !selected || selected.isDraft;
  };

  const loadRealEstateImportSources = async () => {
    if (!realEstateImportSourceSelect) return;
    try {
      const response = await fetch("/__photosbyelie/import-sources?kind=real-estate", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Could not load real estate import sources.");
      renderRealEstateImportSourceOptions(Array.isArray(payload.sources) ? payload.sources : []);
    } catch {
      renderRealEstateImportSourceOptions([]);
    }
  };

  const realEstateImportSourceForRun = async (selected) => {
    if (!realEstateImportSourceSelect) {
      const path = currentRealEstateSourceRoot(selected);
      return path ? { path, name: folderNameFromPath(path) || path } : null;
    }
    const choice = realEstateImportSourceSelect.value || "new";
    if (choice === "new") {
      if (realEstateImportSourceDialogOpen) return null;
      realEstateImportSourceDialogOpen = true;
      realEstateImportSourceSelect.disabled = true;
      setRealEstateStatus("Choose the real estate source folder...");
      try {
        const selectedFolder = await chooseImportFolder();
        if (!selectedFolder) {
          renderRealEstateImportSourceOptions(realEstateImportSourceOptions);
          setRealEstateStatus("Real Estate import folder selection cancelled.");
          return null;
        }
        return selectRealEstateImportSourceFolder(selectedFolder);
      } finally {
        realEstateImportSourceDialogOpen = false;
        renderRealEstateImportSourceOptions(realEstateImportSourceOptions);
      }
    }
    return {
      path: choice,
      name: realEstateImportSourceLabel(choice),
    };
  };

  const renderImportSourceOptions = (sources = []) => {
    if (!importSourceSelect) return;
    const previous = importSourceSelect.value;
    importSourceOptions = sources
      .map((source) => ({
        path: String(source?.path || "").trim(),
        label: String(source?.label || "").trim(),
        exists: source?.exists !== false,
        discovered: Boolean(source?.discovered),
      }))
      .filter((source) => source.path);
    importSourceSelect.textContent = "";
    const addOption = (value, label, title = "") => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      if (title) option.title = title;
      importSourceSelect.append(option);
    };
    importSourceOptions.forEach((source) => {
      const label = `${source.label || source.path}${source.exists ? "" : " (missing)"}`;
      addOption(source.path, label, source.path);
    });
    addOption("all", "All");
    addOption("new", "New...");
    const values = new Set([...importSourceSelect.options].map((option) => option.value));
    importSourceSelect.value = values.has(previous)
      ? previous
      : importSourceOptions[0]?.path || "all";
    lastImportSourceValue = importSourceSelect.value;
    syncR2ActionButtons();
    renderImportSourceDetails();
    if (!latestR2ProgressTasks.some((task) => ["repair", "gap-fill", "maintenance"].includes(task?.operation))) {
      renderImportDashboardIdle();
    }
  };

  const loadImportSources = async () => {
    if (!importSourceSelect) return;
    try {
      const response = await fetch("/__photosbyelie/import-sources", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Could not load import sources.");
      renderImportSourceOptions(Array.isArray(payload.sources) ? payload.sources : []);
    } catch {
      renderImportSourceOptions([]);
    }
  };

  const updateImportSourceHistory = async (action, source = importSourceByPath(importSourceSelect?.value)) => {
    if (!source?.path) return;
    const response = await fetch("/__photosbyelie/import-sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "expo",
        path: source.path,
        action,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Could not update import source history.");
    const nextSources = Array.isArray(payload.sources) ? payload.sources : [];
    const nextValue = action === "remove" ? "" : source.path;
    renderImportSourceOptions(nextSources);
    if (nextValue && importSourceByPath(nextValue)) {
      importSourceSelect.value = nextValue;
      lastImportSourceValue = nextValue;
      renderImportSourceDetails();
    }
  };

  const selectedApplePhotosAlbum = () => (
    applePhotosAlbums.find((album) => album.localIdentifier === applePhotosAlbumSelect?.value) || null
  );

  const renderApplePhotosPreview = (payload = null) => {
    if (!applePhotosCounts || !applePhotosPreview) return;
    if (!payload) {
      setHtml(applePhotosCounts, "");
      setHtml(applePhotosPreview, "");
      applePhotosPreview.hidden = true;
      return;
    }
    const items = Array.isArray(payload.items) ? payload.items : [];
    const unavailable = items.filter((item) => item.status === "unavailable_from_icloud").length;
    const rows = [
      ["Album", payload.album?.title || selectedApplePhotosAlbum()?.title || "Apple Photos"],
      ["Candidates", formatCount(payload.candidateCount ?? payload.materializedCount ?? 0)],
      ["Blocked/skipped", formatCount((payload.blockedCount ?? 0) + unavailable)],
      ["Total checked", formatCount(payload.count || items.length || 0)],
    ];
    setHtml(applePhotosCounts, ownerCountRowsHtml(rows, new Set(["Album"])));
    const previewRows = items.slice(0, 16).map((item) => {
      const statusText = item.status === "candidate" ? "Candidate"
        : item.status === "materialized" ? "Ready"
          : item.status === "unavailable_from_icloud" ? "iCloud original not local"
            : item.status === "blocked_by_policy" ? "Blocked by policy"
              : "Skipped";
      return `
        <div class="owner-coverage-missing-row">
          <strong>${escapeHtml(statusText)}</strong>
          <span>${escapeHtml(item.filename || item.localIdentifier || "Apple Photos asset")}</span>
          ${item.reason ? `<small>${escapeHtml(item.reason)}</small>` : ""}
        </div>
      `;
    }).join("");
    setHtml(applePhotosPreview, previewRows || "<p>No Apple Photos assets returned.</p>");
    applePhotosPreview.hidden = false;
  };

  const setApplePhotosBusy = (busy) => {
    applePhotosBusy = Boolean(busy);
    [applePhotosAlbumSelect, applePhotosRefreshButton, applePhotosPreflightButton, applePhotosImportButton].forEach((control) => {
      if (control) control.disabled = applePhotosBusy;
    });
  };

  const setApplePhotosStatus = (message) => {
    setText(applePhotosStatus, message);
  };

  const renderApplePhotosAlbums = (albums = []) => {
    if (!applePhotosAlbumSelect) return;
    const previous = applePhotosAlbumSelect.value;
    applePhotosAlbums = albums
      .map((album) => ({
        localIdentifier: String(album?.localIdentifier || "").trim(),
        title: String(album?.title || "").trim() || "(Untitled)",
        assetCount: Number(album?.assetCount || 0),
      }))
      .filter((album) => album.localIdentifier);
    applePhotosAlbumSelect.textContent = "";
    if (!applePhotosAlbums.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No albums found";
      applePhotosAlbumSelect.append(option);
      return;
    }
    applePhotosAlbums.forEach((album) => {
      const option = document.createElement("option");
      option.value = album.localIdentifier;
      option.textContent = `${album.title} (${formatCount(album.assetCount)})`;
      option.title = album.localIdentifier;
      applePhotosAlbumSelect.append(option);
    });
    const values = new Set(applePhotosAlbums.map((album) => album.localIdentifier));
    applePhotosAlbumSelect.value = values.has(previous) ? previous : applePhotosAlbums[0].localIdentifier;
    if (applePhotosLastOperation?.source?.albumLocalIdentifier !== applePhotosAlbumSelect.value) {
      applePhotosLastOperation = null;
    }
  };

  const loadApplePhotosAlbums = async () => {
    if (!applePhotosAlbumSelect || !hiddenActions?.enabled) return;
    setApplePhotosBusy(true);
    setApplePhotosStatus("Loading Apple Photos albums through the local helper...");
    try {
      const response = await fetch("/__photosbyelie/apple-photos/albums", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Could not load Apple Photos albums.");
      renderApplePhotosAlbums(Array.isArray(payload.albums) ? payload.albums : []);
      setApplePhotosStatus("Choose an album, run dry run, then import when the candidate list looks right.");
    } catch (error) {
      renderApplePhotosAlbums([]);
      setApplePhotosStatus(error?.message || "Apple Photos albums are unavailable. Check macOS Photos permission for the local helper.");
    } finally {
      setApplePhotosBusy(false);
    }
  };

  const applePhotosRequestPayload = (extra = {}) => {
    const album = selectedApplePhotosAlbum();
    if (!album) throw new Error("Choose an Apple Photos album first.");
    const operationId = applePhotosLastOperation?.source?.albumLocalIdentifier === album.localIdentifier
      ? applePhotosLastOperation.operationId
      : "";
    return {
      albumLocalIdentifier: album.localIdentifier,
      ...(operationId ? { operationId } : {}),
      ...extra,
    };
  };

  const runApplePhotosPreflight = async () => {
    setApplePhotosBusy(true);
    setApplePhotosStatus("Running Apple Photos dry run...");
    try {
      const response = await fetch("/__photosbyelie/apple-photos/preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(applePhotosRequestPayload()),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Apple Photos dry run failed.");
      applePhotosLastOperation = payload.operation || null;
      renderApplePhotosPreview(payload);
      setApplePhotosStatus(`Dry run complete: ${formatCount(payload.candidateCount || 0)} import candidates, ${formatCount(payload.blockedCount || 0)} blocked or unsupported.`);
    } catch (error) {
      setApplePhotosStatus(error?.message || "Apple Photos dry run failed.");
    } finally {
      setApplePhotosBusy(false);
    }
  };

  const startApplePhotosImport = async () => {
    setApplePhotosBusy(true);
    setApplePhotosStatus("Materializing Apple Photos assets and starting import...");
    try {
      const response = await fetch("/__photosbyelie/apple-photos/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(applePhotosRequestPayload()),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Apple Photos import failed.");
      applePhotosLastOperation = payload.operation || applePhotosLastOperation;
      renderApplePhotosPreview(payload.materialized || payload.preflight || null);
      if (payload.task) {
        r2RepairActive = payload.task.operation === "repair";
        renderR2Progress([payload.task]);
        startR2Polling();
      }
      setApplePhotosStatus(payload.message || "Apple Photos import started.");
    } catch (error) {
      setApplePhotosStatus(error?.message || "Apple Photos import failed.");
    } finally {
      setApplePhotosBusy(false);
    }
  };

  const syncR2ActionButtons = () => {
    const busy = r2RepairActive || r2GapFillActive || r2MaintenanceActive;
    if (r2FixButton) {
      r2FixButton.disabled = busy;
      r2FixButton.textContent = busy
        ? "Task running"
        : "Start Expo import";
      r2FixButton.title = `Start Expo import from ${importSourceChoiceLabel()}`;
    }
    if (importSourceSelect) importSourceSelect.disabled = busy;
    const gapCount = r2GapPhotoCount();
    r2FillGapsButtons.forEach((button) => {
      button.disabled = r2CoverageOk || busy || gapCount === 0;
      button.textContent = r2GapFillActive ? "Filling gaps..." : "Fill in gaps";
      button.title = gapCount
        ? `Render and upload missing media for ${formatCount(gapCount)} incomplete photos`
        : "No incomplete upload photos are listed";
    });
    r2MaintenanceButtons.forEach((button) => {
      const key = button.dataset.ownerR2Maintenance || "";
      if (!button.dataset.ownerDefaultLabel) {
        button.dataset.ownerDefaultLabel = button.textContent || R2_MAINTENANCE_LABELS.get(key) || "Maintenance";
      }
      button.disabled = busy;
      button.textContent = r2MaintenanceActive && activeR2MaintenanceKey === key
        ? "Running..."
        : button.dataset.ownerDefaultLabel;
      button.title = busy
        ? "Another import or maintenance task is running"
        : `Start ${button.dataset.ownerDefaultLabel}`;
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
    const preflight = lastMatch(/^PBE_PREFLIGHT\s+({.+})$/);
    const preflightPayload = parsePayloadMatch(preflight);
    const phaseMarker = lastMatch(/^SWEEP_PHASE\s+(\S+)\s+(.+)/);
    const rawPhaseKey = phaseMarker?.match?.[1] || "";
    const importPhaseKey = normalizeSweepPhaseKey(rawPhaseKey);
    const lastImportPhaseKey = (() => {
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const key = normalizeSweepPhaseKey(lines[index].match(/^SWEEP_PHASE\s+(\S+)/)?.[1]);
        if (PHOTO_IMPORT_PHASES.has(key)) return key;
      }
      return PHOTO_IMPORT_PHASES.has(importPhaseKey) ? importPhaseKey : "";
    })();
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
          sourcePath: "",
          phaseKey: lastImportPhaseKey || importPhaseKey,
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
      if (payload.sourcePath) row.sourcePath = String(payload.sourcePath);
      if (lastImportPhaseKey || importPhaseKey) row.phaseKey = lastImportPhaseKey || importPhaseKey;
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
    const activeImportCount = Number((importQueueProgressPayload || importQueueStartPayload || {}).active || 0);
    if (activeImportCount > 0 && !importPhotoRows.some((row) => row.status === "running")) {
      const activeRow = importPhotoRows.find((row) => row.status === "queued")
        || importPhotoRows.find((row) => row.status !== "done" && row.status !== "error");
      if (activeRow) {
        activeRow.status = "running";
        activeRow.inferredActive = true;
      }
    }
    const doneKeys = new Set(lines
      .map((line) => normalizeSweepPhaseKey(line.match(/^SWEEP_DONE\s+(\S+)/)?.[1]))
      .filter(Boolean));
    const skippedKeys = new Set(lines
      .map((line) => normalizeSweepPhaseKey(line.match(/^SWEEP_SKIP\s+(\S+)/)?.[1]))
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
    let phaseKey = normalizeSweepPhaseKey(rawPhaseKey);
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
      rawPhaseKey,
      lastImportPhaseKey,
      doneKeys,
      skippedKeys,
      deleted,
      deleteStart,
      deleteProgress,
      deleteContext,
      deleteContextPayload,
      preflight,
      preflightPayload,
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

  const sourceImportProgress = (logSummary, task = null) => {
    const rows = Array.isArray(logSummary?.importPhotoRows) ? logSummary.importPhotoRows : [];
    const succeededRows = rows.filter((row) => row.status === "done").length;
    const failedRows = rows.filter((row) => row.status === "error").length;
    const finishedRows = succeededRows + failedRows;
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
    const succeeded = Math.max(succeededRows, Number(queuePayload.succeeded ?? scanPayload.succeeded ?? 0));
    const failed = Math.max(failedRows, Number(queuePayload.failed ?? scanPayload.failed ?? 0));
    const rawActiveItemCount = Math.max(0, Number(queuePayload.active ?? scanPayload.active ?? (runningRow ? 1 : 0)));
    const rawQueueDepth = Math.max(0, Number(queuePayload.queueDepth ?? scanPayload.queueDepth ?? Math.max(0, queued - processed - rawActiveItemCount)));
    const planQueueDepth = Number(queuePayload.planQueueDepth ?? scanPayload.planQueueDepth ?? 0);
    const plannerActive = Number(queuePayload.plannerActive ?? scanPayload.plannerActive ?? 0);
    const alreadySelected = Number(scanPayload.alreadySelected ?? queuePayload.alreadySelected ?? 0);
    const workers = Math.max(1, Number(queuePayload.workers ?? scanPayload.workers ?? 1));
    const scannedFiles = Number(scanPayload.seen ?? queuePayload.seen ?? numberFromLog(logSummary?.scan?.match?.[1]) ?? 0);
    const inspectedFiles = Number(scanPayload.inspected ?? queuePayload.inspected ?? numberFromLog(logSummary?.scan?.match?.[2]) ?? 0);
    const scanDone = Boolean(logSummary?.importScanDonePayload);
    const selected = Math.max(queued, processed + rawQueueDepth + rawActiveItemCount, selectedFromScan, rows.length);
    const completed = Math.max(rows.length ? finishedRows : 0, processed, numberFromLog(logSummary?.imported?.match?.[1]));
    const activeItemCount = selected
      ? Math.min(rawActiveItemCount, Math.max(0, selected - completed))
      : rawActiveItemCount;
    const queueDepth = selected
      ? Math.max(0, selected - completed - activeItemCount)
      : rawQueueDepth;
    const startedIndex = rows.length
      ? completed + (runningRow ? 1 : 0)
      : numberFromLog(logSummary?.started?.match?.[1]);
    const current = Math.max(completed + (activeItemCount ? 1 : 0), startedIndex);
    const active = task?.state === "queued" || task?.state === "running";
    const scanningForMore = Boolean(active && (hasQueueEvents ? !scanDone : selected && completed >= selected));
    const scanDraining = Boolean(active && scanDone && (queueDepth > 0 || activeItemCount > 0));
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
      rawQueueDepth,
      planQueueDepth,
      plannerActive,
      alreadySelected,
      workers,
      scannedFiles,
      inspectedFiles,
      completed,
      processed,
      processedThisRun: completed,
      failedThisRun: failed,
      attemptedThisRun: completed,
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

  const sourceLaneAction = () => (
    "Pipeline: scanner finds source files, planner checks metadata and trusted R2 coverage, render/upload workers only create missing boxes."
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
    add("Worker pool", details.workerPool);
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

  const importQueueStatusText = (progress = {}) => {
    const waiting = Math.max(0, Number(progress.queueDepth || 0));
    const activeItems = Math.max(0, Number(progress.activeItemCount || 0));
    const parts = [
      waiting ? `${formatCount(waiting)} waiting` : "",
      activeItems ? `${formatCount(activeItems)} active` : "",
    ].filter(Boolean);
    return parts.length ? parts.join(", ") : "no waiting photos";
  };

  const importStatsTimeLeft = (progress = {}) => {
    const value = String(progress.countdown || "").trim();
    if (!value || value === "Estimating") return "Estimating";
    if (value === "Scanner is still building the queue") return "Building queue";
    return value;
  };

  const importStatsRows = (progress = {}) => {
    const eligiblePhotosFound = Number(progress.alreadySelected || 0) + Number(progress.selected || 0);
    const photosFound = eligiblePhotosFound || Number(progress.scannedFiles || 0);
    const waiting = Math.max(0, Number(progress.queueDepth || 0));
    const activeItems = Math.max(0, Number(progress.activeItemCount || 0));
    const processedThisRun = Math.max(0, Number(progress.processedThisRun ?? progress.completed ?? 0));
    const attemptedThisRun = Math.max(0, Number(progress.attemptedThisRun ?? progress.completed ?? 0));
    const failedThisRun = Math.max(0, Number(progress.failedThisRun || 0));
    const succeededThisRun = Math.max(0, processedThisRun - failedThisRun);
    const currentRunNote = [
      succeededThisRun ? `${formatCount(succeededThisRun)} ok` : "",
      failedThisRun ? `${formatCount(failedThisRun)} failed` : "",
      activeItems ? `${formatCount(activeItems)} active` : "",
      waiting ? `${formatCount(waiting)} waiting` : "",
      !failedThisRun && !activeItems && !waiting ? "none waiting" : "",
    ].filter(Boolean).join(" / ");
    return [
      {
        label: "Photos found",
        value: formatCount(photosFound),
        note: eligiblePhotosFound ? (progress.scanDone ? "eligible" : "eligible so far") : progress.scanDone ? "scan complete" : "scanning",
      },
      {
        label: "Processed before",
        value: formatCount(Math.max(0, Number(progress.alreadySelected || 0))),
        note: "already current",
      },
      {
        label: "Processed this run",
        value: formatCount(processedThisRun),
        note: attemptedThisRun > processedThisRun && !failedThisRun
          ? `${formatCount(attemptedThisRun)} checked`
          : currentRunNote,
      },
      {
        label: "Time left",
        value: importStatsTimeLeft(progress),
        note: progress.scanningForMore ? "current queue" : "estimate",
      },
    ];
  };

  const sourceImportProgressDetail = (progress, phaseKey = "camera") => {
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
      const queue = importQueueStatusText(progress);
      const planner = progress.plannerActive || progress.planQueueDepth
        ? ` Planner has ${formatCount(progress.planQueueDepth)} scan batches waiting.`
        : "";
      return `${sourceLabel} queue: ${completed} / ${selected} photos processed, ${queue}; scanner is still adding any newly discovered work.${inspected}${planner}`;
    }
    if (progress.scanDraining) {
      return `${sourceLabel} scan is complete; draining the queue oldest-first: ${completed} / ${selected} photos processed, ${importQueueStatusText(progress)}; ${timeLeft}.`;
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
      : sourceImportProgress(logSummary, task)
  );

  const sourceLaneProgressDetail = (phaseKey, progress) => (
    phaseKey === "real-estate" && progress.selected === undefined
      ? progress.detail
      : sourceImportProgressDetail(progress, phaseKey)
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
      return `${sourceLabel} queue: ${formatCount(progress.completed)} / ${formatCount(progress.selected)} photos processed so far, ${importQueueStatusText(progress)}; scanner is still looking for more work.${inspected}`;
    }
    if (progress.scanDraining) {
      return `${sourceLabel} scan complete; queue drain: ${formatCount(progress.completed)} / ${formatCount(progress.selected)} photos processed, ${importQueueStatusText(progress)}.`;
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
    if (phase.key === "preflight" && logSummary?.preflightPayload) {
      return { percent: 100, detail: logSummary.preflightPayload.ok ? "Checks passed" : "Needs attention" };
    }
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
    if (phase.key === "preflight" && logSummary?.preflightPayload?.ok) return "Checks passed";
    if (phase.key === "coverage") return "Satisfied";
    return "Done";
  };

  const ownerCountRowsHtml = (rows, wideLabels = new Set()) => rows.map(([label, value]) => `
    <div class="${wideLabels.has(label) ? "is-wide" : ""}">
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(value)}</dd>
    </div>
  `).join("");

  const ownerImportStatsHtml = (rows = []) => {
    if (!Array.isArray(rows) || !rows.length) return "";
    return `
      <dl class="owner-import-stats" aria-label="Import stats">
        ${rows.map((row) => `
          <div>
            <dt>${escapeHtml(row.label)}</dt>
            <dd>${escapeHtml(row.value)}</dd>
            ${row.note ? `<span>${escapeHtml(row.note)}</span>` : ""}
          </div>
        `).join("")}
      </dl>
    `;
  };

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

  const importMatrixRowQueued = (photo = {}) => !["running", "done", "error"].includes(String(photo.status || ""));

  const importMatrixStillImagePath = (photo = {}) => (
    /\.(jpe?g|png|tiff?|heic|heif|webp)$/i.test(String(photo.sourcePath || photo.relativePath || ""))
  );

  const importMatrixThumbnailUrl = (photo = {}, phaseKey = "") => {
    if (!importMatrixStillImagePath(photo)) return "";
    const params = new URLSearchParams();
    const lane = photo.phaseKey || phaseKey || "";
    if (lane) params.set("phase", lane);
    if (photo.sourcePath) params.set("source", photo.sourcePath);
    else if (photo.relativePath && PHOTO_IMPORT_PHASES.has(lane)) params.set("path", photo.relativePath);
    if (!params.has("source") && !params.has("path")) return "";
    return `/__photosbyelie/import-source-thumb?${params.toString()}`;
  };

  const importMatrixThumbHtml = (photo = {}, phaseKey = "") => {
    const url = importMatrixThumbnailUrl(photo, phaseKey);
    const fallback = String(photo.mediaType || "").toLowerCase() === "video" ? "Video" : "";
    if (!url) return `<span class="owner-import-thumb owner-import-thumb-empty">${escapeHtml(fallback)}</span>`;
    return `
      <span class="owner-import-thumb">
        <img src="${escapeHtml(url)}" alt="" loading="eager" decoding="async" onerror="this.closest('.owner-import-thumb')?.classList.add('owner-import-thumb-empty');this.remove();">
      </span>
    `;
  };

  const importMatrixHtml = (photos = [], phaseKey = "") => {
    if (!photos.length) return "";
    const visibleInfo = importMatrixVisibleInfo(photos);
    const visibleRows = visibleInfo.rows;
    if (!visibleRows.length) return "";
    return `
      <div class="owner-import-matrix-wrap" aria-label="Per-photo import progress">
        <div class="owner-import-photo-list">
          ${visibleRows.map((photo) => `
            <div class="owner-import-photo-row ${photo.status === "running" ? "is-running" : photo.status === "done" ? "is-done" : photo.status === "error" ? "is-error" : importMatrixRowQueued(photo) ? "is-next" : ""}">
              ${importMatrixThumbHtml(photo, phaseKey)}
              <span class="owner-import-photo-copy">
                <strong>${escapeHtml(photo.id)}</strong>
                <span>${escapeHtml(photo.relativePath || photo.country || "")}</span>
              </span>
            </div>
          `).join("")}
        </div>
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
    if (task?.operation === "maintenance") {
      const keys = Array.isArray(task?.phaseScopeKeys) ? task.phaseScopeKeys.map(normalizeSweepPhaseKey).filter(Boolean) : [];
      return keys.length
        ? keys.map((key) => SWEEP_PHASES.find((phase) => phase.key === key) || { key, label: key })
        : SWEEP_PHASES.filter((phase) => phase.key === normalizeSweepPhaseKey(task?.currentPhaseKey || ""));
    }
    if (task?.operation === "imports-idle") {
      return [];
    }
    const selectedFolderSweep = Boolean(String(task?.sourceRoot || "").trim())
      || normalizeSweepPhaseKey(task?.currentPhaseKey || "") === "selected-folder";
    return SWEEP_PHASES.filter((phase) => {
      if (phase.key === "private" && task?.currentPhaseKey !== "private") return false;
      if (selectedFolderSweep) return !FIXED_IMPORT_DASHBOARD_PHASE_KEYS.includes(phase.key);
      return phase.key !== "selected-folder";
    });
  };

  const phaseLabelForKey = (phaseKey, task = null) => (
    phaseListForTask(task).find((phase) => phase.key === normalizeSweepPhaseKey(phaseKey))?.label
    || SWEEP_PHASES.find((phase) => phase.key === normalizeSweepPhaseKey(phaseKey))?.label
    || ""
  );

  const visiblePhaseList = (phaseList, task, activeKey, active, failed, complete, logSummary, detailRowsByPhase, matrixRowsByPhase) => {
    if (task?.operation === "imports-idle") return [];
    const doneKeys = logSummary?.doneKeys instanceof Set ? logSummary.doneKeys : new Set();
    const logSkippedKeys = logSummary?.skippedKeys instanceof Set ? logSummary.skippedKeys : new Set();
    const skippedKeys = new Set([
      ...[...logSkippedKeys],
      ...((Array.isArray(task?.skipPhases) ? task.skipPhases : []).map(normalizeSweepPhaseKey).filter(Boolean)),
    ]);
    const visibleKeys = new Set();
    if (activeKey) visibleKeys.add(activeKey);
    if (failed && activeKey) visibleKeys.add(activeKey);
    [...doneKeys, ...skippedKeys].forEach((key) => key && visibleKeys.add(key));
    if (detailRowsByPhase instanceof Map) [...detailRowsByPhase.keys()].forEach((key) => visibleKeys.add(normalizeSweepPhaseKey(key)));
    if (matrixRowsByPhase instanceof Map) [...matrixRowsByPhase.keys()].forEach((key) => visibleKeys.add(normalizeSweepPhaseKey(key)));
    if (task?.operation === "maintenance" && active) {
      (Array.isArray(task.phaseScopeKeys) ? task.phaseScopeKeys : [])
        .map(normalizeSweepPhaseKey)
        .filter(Boolean)
        .forEach((key) => visibleKeys.add(key));
    }
    if (complete && !visibleKeys.size && phaseList.length) visibleKeys.add(phaseList.at(-1).key);
    const base = phaseList.filter((phase) => visibleKeys.has(phase.key));
    const knownKeys = new Set(base.map((phase) => phase.key));
    const extra = [...visibleKeys]
      .filter((key) => key && !knownKeys.has(key))
      .map((key) => ({ key, label: phaseLabelForKey(key, task) || key }));
    return [...base, ...extra];
  };

  const renderSweepPhases = (task, logSummary = null, detailRowsByPhase = new Map(), matrixRowsByPhase = new Map(), statsRowsByPhase = new Map()) => {
    if (!r2Phases) return;
    if (!task || !["repair", "gap-fill", "maintenance", "imports-idle"].includes(task.operation)) {
      r2PhaseRenderSnapshot = null;
      setHtml(r2Phases, "");
      return;
    }
    const fullPhaseList = phaseListForTask(task);
    const active = task.state === "queued" || task.state === "running";
    const coverageIncomplete = task.operation === "repair" && !active && task.state === "done" && r2CoverageOk === false;
    const failed = Number(task.failed || 0) > 0 || task.state === "failed" || coverageIncomplete;
    const complete = !active && !failed && task.state === "done";
    const taskPhaseKey = normalizeSweepPhaseKey(task?.currentPhaseKey || "");
    const logPhaseKey = normalizeSweepPhaseKey(logSummary?.phaseKey || "");
    const activeKey = coverageIncomplete
      ? "coverage"
      : active
      ? (taskPhaseKey || logPhaseKey || "prepare")
      : (logPhaseKey || taskPhaseKey || "prepare");
    const phaseList = visiblePhaseList(fullPhaseList, task, activeKey, active, failed, complete, logSummary, detailRowsByPhase, matrixRowsByPhase);
    r2PhaseRenderSnapshot = { task, logSummary, detailRowsByPhase, matrixRowsByPhase, statsRowsByPhase };
    if (!phaseList.length) {
      setHtml(r2Phases, "");
      return;
    }
    const activeIndex = Math.max(0, phaseList.findIndex((phase) => phase.key === activeKey));
    const doneKeys = logSummary?.doneKeys || new Set();
    const skippedKeys = new Set([
      ...([...((logSummary?.skippedKeys instanceof Set ? logSummary.skippedKeys : new Set()))]),
      ...((Array.isArray(task?.skipPhases) ? task.skipPhases : []).map(normalizeSweepPhaseKey).filter(Boolean)),
    ]);
    const wideLabels = new Set(["Already done", "Cleanup record", "Current phase", "Current file", "Current photo", "Source group", "Owner DB trusted", "Worker pool", "Progress bar counts", "Progress summary", "Upload progress", "Photo rows", "Coverage gaps", "Needs attention", "Notes", "Safe skip", "Skip", "What happens", "Last photo", "Last synced", "Latest error", "Latest log"]);
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
      const statsRows = statsRowsByPhase instanceof Map ? (statsRowsByPhase.get(phase.key) || []) : [];
      const hasProgressNote = Boolean(progress.detail && !genericProgressDetails.has(progress.detail));
      const canExpand = (state === "done" || state === "failed" || state === "skipped") && (phaseRows.length || matrixRows.length || statsRows.length || hasProgressNote);
      const showPhaseDetails = state === "running" || (canExpand && expandedSweepPhaseKeys.has(phase.key));
      const statsHtml = showPhaseDetails && statsRows.length ? ownerImportStatsHtml(statsRows) : "";
      const matrixHtml = showPhaseDetails && matrixRows.length ? importMatrixHtml(matrixRows, phase.key) : "";
      const hasMatrix = Boolean(matrixHtml);
      const detailHtml = showPhaseDetails && phaseRows.length
        ? `<dl class="owner-counts owner-sweep-details">${ownerCountRowsHtml(phaseRows, wideLabels)}</dl>`
        : "";
      const progressNote = showPhaseDetails && hasProgressNote && !statsHtml
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
            ${statsHtml}
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
    const maintenance = latest.operation === "maintenance";
    const coverageIncomplete = latest.operation === "repair" && !active && latest.state === "done" && r2CoverageOk === false;
    const failureCount = Number(latest.failed || 0);
    const failed = failureCount > 0 || latest.state === "failed" || coverageIncomplete;
    const latestPhaseKey = normalizeSweepPhaseKey(latest.currentPhaseKey || "");
    const logPhaseKey = normalizeSweepPhaseKey(logSummary?.phaseKey || "");
    const activePhaseKey = coverageIncomplete
      ? "coverage"
      : active
      ? (latestPhaseKey || logPhaseKey || "prepare")
      : (logPhaseKey || latestPhaseKey || "prepare");
    const activePhaseLabel = phaseLabelForKey(activePhaseKey, latest) || logSummary?.phase || "Current phase";
    const logMatchesActivePhase = !active || !logSummary?.phaseKey || normalizeSweepPhaseKey(logSummary.phaseKey) === activePhaseKey;
    const skippedPhaseKeys = new Set([
      ...([...((logSummary?.skippedKeys instanceof Set ? logSummary.skippedKeys : new Set()))]),
      ...((Array.isArray(latest?.skipPhases) ? latest.skipPhases : []).map(normalizeSweepPhaseKey).filter(Boolean)),
    ]);
    const skippedSourceLanes = [...skippedPhaseKeys].filter((key) => PHOTO_IMPORT_PHASES.has(key));
    const catalogBlocked = !active && activePhaseKey === "catalog" && (
      logSummary?.rawPhaseKey === "catalog-blocked"
      || /Catalog export blocked/i.test(logSummary?.phase || "")
      || /Catalog export blocked/i.test(logSummary?.latest || "")
    );
    if (active) {
      if (latest.external_pid) {
        setText(r2Summary, activePhaseLabel
          ? `${activePhaseLabel}. Existing sweep pid ${latest.external_pid}.`
          : `Cloud media sweep is already running with pid ${latest.external_pid}.`);
      } else {
        setText(r2Summary, gapFill
          ? `${activePhaseLabel}: completing the visible photo rows.`
          : maintenance
          ? `${activePhaseLabel}: ${latest.label || "maintenance"} is running.`
          : activePhaseLabel
          ? `${activePhaseLabel}.`
          : "Running the lock-guarded cloud media sweep.");
      }
    } else if (failed) {
      setText(r2Summary, gapFill
        ? "Fill in gaps stopped before all missing uploads completed."
        : maintenance
        ? `${latest.label || "Maintenance"} needs attention.`
        : coverageIncomplete
        ? `R2 repair finished, but coverage is still missing (${coverageMissingDetail()}).`
        : catalogBlocked
        ? "Catalog export was blocked because source imports were skipped or interrupted."
        : logSummary?.phase === "Needs attention"
        ? "R2 coverage repair needs attention."
        : "R2 coverage repair stopped before completion.");
    } else {
      setText(r2Summary, gapFill
        ? "Last upload gap fill finished."
        : maintenance
        ? `Last ${latest.label || "maintenance task"} finished.`
        : "Last R2 coverage repair finished.");
    }
    const detailRowsByPhase = new Map();
    const matrixRowsByPhase = new Map();
    const statsRowsByPhase = new Map();
    const addPhaseRow = (phaseKey, label, value) => {
      if (!detailRowsByPhase.has(phaseKey)) detailRowsByPhase.set(phaseKey, []);
      detailRowsByPhase.get(phaseKey).push([label, value]);
    };
    const setPhaseStats = (phaseKey, rows) => {
      if (phaseKey && Array.isArray(rows) && rows.length) statsRowsByPhase.set(phaseKey, rows);
    };
    let lastPhotoId = "";
    if (active && latest.external_pid) addPhaseRow(activePhaseKey, "Sweep PID", latest.external_pid);
    if (logSummary?.preflightPayload) {
      const payload = logSummary.preflightPayload;
      const python = payload.python || {};
      const tools = Array.isArray(payload.tools) ? payload.tools : [];
      const sources = Array.isArray(payload.sources) ? payload.sources : [];
      const r2 = payload.r2 || {};
      const toolSummary = tools.length
        ? tools.map((tool) => `${tool.name}: ${tool.ok ? "OK" : "missing"}`).join(", ")
        : "No tool results";
      const sourceSummary = sources.length
        ? sources.map((source) => `${source.label || source.phase}: ${source.status || (source.ok ? "ok" : "needs attention")}`).join(", ")
        : "No source checks";
      addPhaseRow("preflight", "Pillow", python.pillow === "ok" ? `OK for ${python.executable || "Python"}` : `Missing for ${python.executable || "Python"}`);
      addPhaseRow("preflight", "Tools", toolSummary);
      addPhaseRow("preflight", "R2 upload", r2.ok ? `${r2.backend || "R2"} ready` : `${r2.backend || "R2"} needs attention`);
      addPhaseRow("preflight", "Sources", sourceSummary);
      if (!payload.ok && Array.isArray(payload.errors) && payload.errors.length) addPhaseRow("preflight", "Needs attention", payload.errors[0]);
    }
    if (catalogBlocked) {
      addPhaseRow("catalog", "Needs attention", "Catalog export was held back because one or more source import lanes were left unfinished.");
      if (skippedSourceLanes.length) {
        addPhaseRow("catalog", "Unfinished source lanes", skippedSourceLanes.map((key) => importSourceLabel(key)).join(", "));
      }
      addPhaseRow("catalog", "What happens", "Start Import refuses to publish a new catalog after skipped source lanes unless partial publishing is explicitly allowed.");
    }
    const matrixPhaseKey = PHOTO_IMPORT_PHASES.has(activePhaseKey)
      ? activePhaseKey
      : PHOTO_IMPORT_PHASES.has(logSummary?.lastImportPhaseKey)
      ? logSummary.lastImportPhaseKey
      : activePhaseKey === "gap-fill"
      ? "gap-fill"
      : "";
    const shouldShowImportMatrix = Boolean(
      matrixPhaseKey
      && logSummary?.importPhotoRows?.length
      && (logMatchesActivePhase || catalogBlocked || latest.state === "failed")
    );
    if (shouldShowImportMatrix) {
      const visibleMatrixInfo = importMatrixVisibleInfo(logSummary.importPhotoRows);
      const visibleMatrixRows = visibleMatrixInfo.rows;
      const sourceProgress = PHOTO_IMPORT_PHASES.has(matrixPhaseKey)
        ? sourceLaneProgress(matrixPhaseKey, logSummary, latest)
        : null;
      if (sourceProgress) setPhaseStats(matrixPhaseKey, importStatsRows(sourceProgress));
      if (visibleMatrixRows.length) matrixRowsByPhase.set(matrixPhaseKey, logSummary.importPhotoRows);
      addPhaseRow(
        matrixPhaseKey,
        "Photo rows",
        visibleMatrixInfo.runningCount || visibleMatrixInfo.visibleQueuedCount
          ? `${formatCount(visibleMatrixInfo.runningCount)} working, ${formatCount(visibleMatrixInfo.visibleQueuedCount)} next queued shown${visibleMatrixInfo.hiddenQueuedCount ? `, ${formatCount(visibleMatrixInfo.hiddenQueuedCount)} more queued hidden` : ""}${visibleMatrixInfo.doneCount ? `, ${formatCount(visibleMatrixInfo.doneCount)} just finished` : ""}`
          : visibleMatrixInfo.doneCount
          ? `${formatCount(visibleMatrixInfo.doneCount)} just finished`
          : sourceProgress?.scanningForMore
          ? `No active rows right now; scanning for more ${importSourceLabel(matrixPhaseKey)} work`
          : "No active rows",
      );
    }
    if (logMatchesActivePhase && activePhaseKey === "gap-fill") {
      const progress = gapFillProgress(logSummary, latest);
      addPhaseRow("gap-fill", "Progress summary", `${formatCount(progress.finishedRows)} / ${formatCount(progress.total)} incomplete photos finished`);
      if (progress.failed) addPhaseRow("gap-fill", "Needs attention", `${formatCount(progress.failed)} photos failed`);
      addPhaseRow("gap-fill", "What happens", "For each already-cataloged incomplete photo: restore the private master if needed, recreate private JPG triplets if needed, recreate public previews if needed, and upload only the missing files.");
    }
    if (logMatchesActivePhase && activePhaseKey === "private") {
      const progress = privateBackfillProgress(logSummary);
      addPhaseRow("private", "Progress bar counts", `${progress.detail} catalog photos with complete private delivery JPG triplets.`);
      addPhaseRow("private", "What happens", "Builds missing private delivery JPGs in the 6MP, 3MP, and 1MP sizes, uploads them to private R2, and refreshes the private delivery manifest for checkout ZIPs.");
      addPhaseRow("private", "Notes", "This is the legacy triplet-only backfill that was already running. Future background sweeps use Fill in gaps for lost masters, triplets, and previews.");
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
      if (PHOTO_IMPORT_PHASES.has(activePhaseKey)) setPhaseStats(activePhaseKey, importStatsRows(progress));
      if (progress.selected) {
        const gapSummary = coverageRepairGapSummary();
        const scanner = progress.scanDone
          ? `Scan complete: ${formatCount(progress.scannedFiles)} source files seen, ${formatCount(progress.inspectedFiles)} inspected.`
          : `Scanning: ${formatCount(progress.scannedFiles)} source files seen, ${formatCount(progress.inspectedFiles)} inspected so far.`;
        const planner = progress.plannerActive || progress.planQueueDepth
          ? `Planning metadata and R2 coverage: ${formatCount(progress.planQueueDepth)} scan batches waiting${progress.plannerActive ? ", 1 active" : ""}.`
          : "Planner is caught up.";
        const queue = `${formatCount(progress.completed)} processed, ${importQueueStatusText(progress)}, ${formatCount(progress.selected)} queued so far.`;
        mergeSourceLaneDetails({
          coverageGaps: gapSummary,
          currentPhoto: progress.completed < progress.selected ? progress.photo : "",
          scanner,
          planner,
          workerPool: progress.workers > 1 ? `${formatCount(progress.workers)} parallel render/upload workers` : "",
          queue,
          notes: "Not found at the current expected R2 key; a file can still exist under an older or wrong-place key.",
        });
      } else {
        mergeSourceLaneDetails({
          currentPhoto: progress.completed < progress.selected ? progress.photo : "",
          scanner: `Scanning: ${formatCount(progress.scannedFiles)} source files seen, ${formatCount(progress.inspectedFiles)} inspected so far.`,
          planner: progress.plannerActive || progress.planQueueDepth
            ? `Planning metadata and R2 coverage: ${formatCount(progress.planQueueDepth)} scan batches waiting${progress.plannerActive ? ", 1 active" : ""}.`
            : "Planner is waiting for source batches.",
          workerPool: progress.workers > 1 ? `${formatCount(progress.workers)} parallel render/upload workers` : "",
          queue: "No needed photos queued yet.",
        });
      }
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
    renderSweepPhases(latest, logSummary, detailRowsByPhase, matrixRowsByPhase, statsRowsByPhase);
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
      r2PhaseRenderSnapshot.statsRowsByPhase,
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
        ? "No import job is running. Current catalog coverage is up to date."
        : `No import job is running. Not up to date yet: ${r2GapStatusText()}`
    );
    const gaps = r2GapCounts();
    const rows = [
      ["State", "Idle"],
      ["Coverage", window.photosByElieR2Coverage ? (r2CoverageOk ? "Up to date" : "Needs work") : "Loading"],
      ["Source scan", "Not running"],
      ["Incomplete photos", window.photosByElieR2Coverage ? formatCount(gaps.photos) : "Checking"],
      ["Missing work", window.photosByElieR2Coverage ? r2GapStatusText() : "Checking R2 coverage"],
      ["Expo source", importSourceChoiceLabel()],
    ];
    setHtml(r2Counts, ownerCountRowsHtml(rows, new Set(["Missing work", "Expo source"])));
    renderSweepPhases(null);
    renderR2PhotoPreview("");
  };

  const loadR2RepairLog = async (task) => {
    if (!task?.id || !["repair", "gap-fill", "maintenance"].includes(task.operation)) return;
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
        blockedPreviewNoteRoot.textContent = "R2 purge is in progress: the undo queue is already cleared, tombstones are preserved, and R2 is deleting up to 6 artifacts per photo: 2 public previews, 1 private master, and 3 private JPG renders.";
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
    r2MaintenanceActive = tasks.some((task) => task?.operation === "maintenance" && (task.state === "queued" || task.state === "running"));
    activeR2MaintenanceKey = tasks.find((task) => task?.operation === "maintenance" && (task.state === "queued" || task.state === "running"))?.maintenanceKey || "";
    const latest = tasks.find((task) => task?.operation === "repair" || task?.operation === "gap-fill" || task?.operation === "maintenance");
    if (!latest) {
      r2RepairActive = false;
      r2GapFillActive = false;
      r2MaintenanceActive = false;
      activeR2MaintenanceKey = "";
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
    const isMaintenance = latest.operation === "maintenance";
    syncR2ActionButtons();
    const activeVerb = isRepair ? "Repairing" : isDelete ? "Deleting" : "Uploading";
    const noun = isRepair ? "repair" : isDelete ? "delete" : "upload";
    if (isRepair || isGapFill || isMaintenance) {
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
        sourcePath: String(item.sourcePath || ""),
        phaseKey: "gap-fill",
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
        ${importMatrixHtml(missingImportPhotos, "gap-fill")}
      ` : missingPrivateDelivery.length ? `
          <h3>Missing private delivery files</h3>
          <p>${escapeHtml(formatCount(missingPrivateDelivery.length))} shown. Start Import asks for a local source folder, uploads missing masters when the source file exists, and rebuilds missing photo JPG triplets.</p>
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
    if (!latestR2ProgressTasks.some((task) => ["repair", "gap-fill", "maintenance"].includes(task?.operation))) {
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
      const repairLikeTask = tasks.find((task) => ["repair", "gap-fill", "maintenance"].includes(task?.operation));
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
        setStatus("Catalog and visibility refreshed.");
      } else if (kind === "blocked-sync") {
        await withTimeout(Promise.all([loadR2Coverage(), loadR2Progress()]), 12000, "Waste Basket refresh");
        await refreshBlockedSyncPanel();
        setStatus("Waste Basket cleanup refreshed.");
      } else if (kind === "coverage") {
        await withTimeout(loadR2Coverage(), 12000, "R2 coverage refresh");
        setStatus("R2 catalog coverage refreshed.");
      } else if (kind === "progress") {
        await withTimeout(Promise.all([loadImportSources(), loadApplePhotosAlbums(), loadR2Progress()]), 12000, "Import dashboard refresh");
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
      } else if (kind === "access-users") {
        await loadAccessUsers();
        setStatus("Cloud roles refreshed.");
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
  resetPricePublishStatus();
  publishPricesButton?.addEventListener("click", publishOwnerPrices);
  renderPodCommerce();
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
    renderPodCommerce();
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
      if (rowAction.dataset.ownerReRowAction === "login") {
        openRealEstateClientLogin(clientId);
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
      ? `${label}: fill client name first; it saves automatically when ready.`
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

  accessUserForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveAccessUser(false);
  });

  accessUserPublishButton?.addEventListener("click", () => {
    saveAccessUser(true);
  });

  accessUserList?.addEventListener("click", (event) => {
    const action = event.target.closest("[data-owner-access-action]");
    if (action) {
      const email = action.dataset.ownerAccessEmail || "";
      selectedAccessUserEmail = email;
      if (action.dataset.ownerAccessAction === "publish") {
        publishAccessUser(email);
        return;
      }
      fillAccessUserForm(accessUserByEmail(email) || {});
      renderAccessUsers();
      setAccessUserStatus(email ? `${email} selected.` : "No cloud role selected.");
      accessUserEmailInput?.focus();
      return;
    }
    const row = event.target.closest("[data-owner-access-email]");
    if (!row) return;
    selectedAccessUserEmail = row.dataset.ownerAccessEmail || "";
    fillAccessUserForm(accessUserByEmail(selectedAccessUserEmail) || {});
    renderAccessUsers();
    setAccessUserStatus(selectedAccessUserEmail ? `${selectedAccessUserEmail} selected.` : "No cloud role selected.");
  });

  wipeHiddenR2Button?.addEventListener("click", async () => {
    if (wasteDeleteActive) {
      setStatus("Waste Basket R2 purge is already running. Watch R2 artifacts left on the card.");
      return;
    }
    const ok = window.confirm("Purge R2 media artifacts for every Waste Basket photo? This deletes up to 6 artifacts per photo: 2 public previews, 1 private master, and 3 private JPG renders. Ban/tombstone records stay, so these photos remain banned and do not return.");
    if (!ok) return;
    wipeHiddenR2Button.disabled = true;
    setStatus("Queueing banned-photo R2 purge...");
    try {
      const result = await hiddenActions.wipeHiddenR2?.();
      renderCounts();
      if (result?.r2_delete_task) renderR2Progress([result.r2_delete_task]);
      loadR2Progress();
      setStatus(`R2 purge queued: ${formatCount(result?.moved_to_tombstones_count || 0)} live bans moved to permanent tombstones, ${formatCount(result?.discarded_count || 0)} total tombstones.`);
      Promise.all([
        refreshDiscardedCount(),
        loadR2Coverage(),
        refreshBlockedSyncPanel(),
      ]).catch((error) => {
        console.warn("Waste Basket refresh after purge queue failed", error);
      });
    } catch (error) {
      setStatus(error?.message || "Could not queue banned-photo R2 purge.");
    } finally {
      if (!wasteDeleteActive) wipeHiddenR2Button.disabled = false;
    }
  });

  [burstCullPreviewButton, burstCullLoadButton].forEach((button) => {
    button?.addEventListener("click", async () => {
      try {
        await loadBurstCullPreview();
      } catch (error) {
        setBurstCullStatus(error?.message || "Could not load burst cull preview.");
      }
    });
  });

  burstCullGoButton?.addEventListener("click", async () => {
    try {
      await runBurstCull();
    } catch (error) {
      setBurstCullStatus(error?.message || "Could not run burst cull.");
    }
  });

  const chooseImportFolder = async () => {
    const response = await fetch("/__photosbyelie/select-import-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Could not choose an import folder.");
    if (payload.cancelled) return null;
    const path = String(payload.path || "").trim();
    if (!path) throw new Error("No import folder was selected.");
    return {
      path,
      name: String(payload.name || "").trim() || path.split(/[\\/]/).filter(Boolean).at(-1) || path,
    };
  };

  realEstateImportSourceSelect?.addEventListener("change", async () => {
    const selected = selectedRealEstateClient();
    const fallback = [...realEstateImportSourceSelect.options].some((option) => option.value === lastRealEstateImportSourceValue)
      ? lastRealEstateImportSourceValue
      : (currentRealEstateSourceRoot(selected) || realEstateImportSourceOptions[0]?.path || "new");
    if ((realEstateImportSourceSelect.value || "new") !== "new") {
      lastRealEstateImportSourceValue = realEstateImportSourceSelect.value;
      setRealEstateStatus(`Selected RE import source: ${realEstateImportSourceLabel(realEstateImportSourceSelect.value)}. Press RE import when ready.`);
      return;
    }
    if (realEstateImportSourceDialogOpen) return;
    realEstateImportSourceDialogOpen = true;
    realEstateImportSourceSelect.disabled = true;
    setRealEstateStatus("Choose the real estate source folder...");
    try {
      const selectedFolder = await chooseImportFolder();
      if (!selectedFolder) {
        realEstateImportSourceSelect.value = fallback;
        lastRealEstateImportSourceValue = fallback;
        setRealEstateStatus("Real Estate import folder selection cancelled.");
        return;
      }
      const source = selectRealEstateImportSourceFolder(selectedFolder);
      setRealEstateStatus(`Selected RE import source: ${source?.name || selectedFolder.name}. Press RE import when ready.`);
    } catch (error) {
      realEstateImportSourceSelect.value = fallback;
      lastRealEstateImportSourceValue = fallback;
      setRealEstateStatus(error?.message || "Could not choose a real estate import folder.");
    } finally {
      realEstateImportSourceDialogOpen = false;
      renderRealEstateImportSourceOptions(realEstateImportSourceOptions);
    }
  });

  importSourceSelect?.addEventListener("change", async () => {
    const choice = importSourceSelect.value || "new";
    if (choice !== "new") {
      lastImportSourceValue = choice;
      syncR2ActionButtons();
      renderImportSourceDetails();
      if (!latestR2ProgressTasks.some((task) => ["repair", "gap-fill", "maintenance"].includes(task?.operation))) {
        renderImportDashboardIdle();
      }
      return;
    }
    if (importSourceDialogOpen) return;
    const fallback = [...importSourceSelect.options].some((option) => option.value === lastImportSourceValue)
      ? lastImportSourceValue
      : importSourceOptions[0]?.path || "all";
    importSourceDialogOpen = true;
    importSourceSelect.disabled = true;
    setStatus("Choose the folder to import...");
    try {
      const selectedFolder = await chooseImportFolder();
      if (!selectedFolder) {
        importSourceSelect.value = fallback;
        lastImportSourceValue = fallback;
        setStatus("Import folder selection cancelled.");
        return;
      }
      selectImportSourceFolder(selectedFolder);
      setStatus(`Selected import folder: ${selectedFolder.name}. Press Start import when ready.`);
    } catch (error) {
      importSourceSelect.value = fallback;
      lastImportSourceValue = fallback;
      setStatus(error?.message || "Could not choose an import folder.");
    } finally {
      importSourceDialogOpen = false;
      syncR2ActionButtons();
      renderImportSourceDetails();
    }
  });

  importSourcePinButton?.addEventListener("click", async () => {
    const source = importSourceByPath(importSourceSelect?.value);
    if (!source) return;
    try {
      await updateImportSourceHistory(source.pinned ? "unpin" : "pin", source);
      setStatus(`${source.pinned ? "Unpinned" : "Pinned"} import source: ${source.label || folderNameFromPath(source.path)}.`);
    } catch (error) {
      setStatus(error?.message || "Could not update import source pin.");
    }
  });

  importSourceReviewButton?.addEventListener("click", async () => {
    const source = importSourceByPath(importSourceSelect?.value);
    if (!source) return;
    try {
      await updateImportSourceHistory("review", source);
      setStatus(`Marked legacy import source reviewed: ${source.label || folderNameFromPath(source.path)}.`);
    } catch (error) {
      setStatus(error?.message || "Could not mark import source reviewed.");
    }
  });

  importSourceRemoveButton?.addEventListener("click", async () => {
    const source = importSourceByPath(importSourceSelect?.value);
    if (!source) return;
    const ok = window.confirm(`Remove remembered import source "${source.label || folderNameFromPath(source.path)}"?\n\nThe folder is removed from Owner.sqlite history only. Files on disk are not touched.`);
    if (!ok) return;
    try {
      await updateImportSourceHistory("remove", source);
      setStatus(`Removed remembered import source: ${source.label || folderNameFromPath(source.path)}.`);
    } catch (error) {
      setStatus(error?.message || "Could not remove remembered import source.");
    }
  });

  applePhotosRefreshButton?.addEventListener("click", loadApplePhotosAlbums);
  applePhotosAlbumSelect?.addEventListener("change", () => {
    applePhotosLastOperation = null;
    renderApplePhotosPreview(null);
    setApplePhotosStatus("Run dry run before importing the selected Apple Photos album.");
  });
  applePhotosPreflightButton?.addEventListener("click", async () => {
    const authorized = await ownerAuth?.requireAuth?.("Start the local Photos By Elie server to preflight Apple Photos imports.");
    if (ownerAuth?.enabled && !authorized) return;
    runApplePhotosPreflight();
  });
  applePhotosImportButton?.addEventListener("click", async () => {
    const authorized = await ownerAuth?.requireAuth?.("Start the local Photos By Elie server to import from Apple Photos.");
    if (ownerAuth?.enabled && !authorized) return;
    const album = selectedApplePhotosAlbum();
    const ok = window.confirm(`Import eligible local assets from Apple Photos album "${album?.title || "selected album"}"?\n\nRun Dry run first if you have not reviewed what will be imported, skipped, or blocked.`);
    if (!ok) return;
    startApplePhotosImport();
  });

  r2FixButton?.addEventListener("click", async () => {
    const authorized = await ownerAuth?.requireAuth?.("Start the local Photos By Elie server to scan an import folder.");
    if (ownerAuth?.enabled && !authorized) return;
    if (!window.photosByElieR2Coverage) {
      setStatus("Loading current catalog coverage before starting imports...");
      await loadR2Coverage();
    }
    const choice = importSourceSelect?.value || "new";
    let selectedFolder = null;
    if (choice === "new") {
      setStatus("Choose the folder to import...");
      try {
        selectedFolder = await chooseImportFolder();
      } catch (error) {
        setStatus(error?.message || "Could not choose an import folder.");
        return;
      }
      if (!selectedFolder) {
        setStatus("Import cancelled before choosing a folder.");
        return;
      }
    } else if (choice !== "all") {
      const source = importSourceByPath(choice);
      selectedFolder = {
        path: choice,
        name: source?.label || choice.split(/[\\/]/).filter(Boolean).at(-1) || choice,
      };
    }
    const confirmText = selectedFolder
      ? `Start the lock-guarded Expo import from "${selectedFolder.name}" now?\n\nThe sweep scans this selected gallery folder, imports developed photo/video files it needs, renders/uploads missing media, refreshes manifests, validates, commits, and pushes changes.`
      : "Start the broad lock-guarded Expo import from all gallery source folders now?\n\nThis scans Camera, Apple Photos, and AI sources, then refreshes manifests, validates, commits, and pushes changes. Real Estate imports live in the Real Estate tab.";
    const ok = window.confirm(confirmText);
    if (!ok) return;
    r2FixButton.disabled = true;
    setStatus(selectedFolder ? `Starting Expo import from ${selectedFolder.name}...` : "Starting broad Expo import from all gallery source folders...");
    try {
      const response = await fetch("/__photosbyelie/r2-fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selectedFolder
          ? {
              sourceRoot: selectedFolder.path,
              sourceSelect: "auto",
            }
          : {
              sourceSelect: "auto",
            }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Could not start imports.");
      const task = payload.task || {};
      r2RepairActive = task.operation === "repair";
      syncR2ActionButtons();
      setStatus(task.operation === "repair"
        ? (selectedFolder ? `Expo import started from ${selectedFolder.name}.` : "Broad Expo import started.")
        : "Another import or maintenance task is already running.");
      setOwnerTab("imports");
      loadImportSources();
      renderR2Progress([task]);
      loadR2Progress();
    } catch (error) {
      r2RepairActive = false;
      syncR2ActionButtons();
      setStatus(error?.message || "Could not start imports.");
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
      const task = payload.task || {};
      r2GapFillActive = task.operation === "gap-fill";
      syncR2ActionButtons();
      setStatus(task.operation === "gap-fill"
        ? "R2 upload gap fill started."
        : "Another import or maintenance task is already running.");
      setOwnerTab("imports");
      renderR2Progress([task]);
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

  const startR2MaintenanceTask = async (maintenanceKey, triggerButton = null) => {
    const label = R2_MAINTENANCE_LABELS.get(maintenanceKey) || triggerButton?.textContent || "Maintenance";
    const authorized = await ownerAuth?.requireAuth?.(`Start the local Photos By Elie server to run ${label}.`);
    if (ownerAuth?.enabled && !authorized) return;
    const ok = window.confirm(`Start ${label} now?`);
    if (!ok) return;
    if (triggerButton) triggerButton.disabled = true;
    setStatus(`Starting ${label}...`);
    try {
      const response = await fetch("/__photosbyelie/r2-fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maintenanceTask: maintenanceKey }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || `Could not start ${label}.`);
      const task = payload.task || {};
      r2MaintenanceActive = task.operation === "maintenance";
      activeR2MaintenanceKey = task.operation === "maintenance" ? maintenanceKey : "";
      syncR2ActionButtons();
      setStatus(task.operation === "maintenance"
        ? `${label} started.`
        : "Another import or maintenance task is already running.");
      setOwnerTab("imports");
      renderR2Progress([task]);
      loadR2Progress();
    } catch (error) {
      r2MaintenanceActive = false;
      activeR2MaintenanceKey = "";
      syncR2ActionButtons();
      setStatus(error?.message || `Could not start ${label}.`);
    }
  };

  r2MaintenanceButtons.forEach((button) => {
    button.addEventListener("click", () => startR2MaintenanceTask(button.dataset.ownerR2Maintenance || "", button));
  });

  importSourceSelect?.addEventListener("change", () => {
    syncR2ActionButtons();
    if (!latestR2ProgressTasks.some((task) => ["repair", "gap-fill", "maintenance"].includes(task?.operation))) {
      renderImportDashboardIdle();
    }
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
      loadVisibilitySummary();
      refreshBlockedSyncPanel();
    }
  });
  if (ownerAuth?.state?.available) {
    refreshCountsFromSource();
    refreshBlockedSyncPanel();
    loadImportSources();
    loadApplePhotosAlbums();
    loadR2Coverage();
    loadCostEstimate();
    loadKeywordBlacklist();
    loadTitleKeywordReviewCount();
    loadRealEstateOwner();
    loadAccessUsers();
    startR2Polling();
  }
})();
