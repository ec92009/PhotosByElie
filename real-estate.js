(() => {
  const app = document.querySelector("[data-real-estate-app]");
  if (!app) return;

  const pageParams = new URLSearchParams(window.location.search);
  const cloudRenderParams = new URLSearchParams(String(window.location.hash || "").replace(/^#/, ""));
  const cloudRenderJobId = String(cloudRenderParams.get("cloudRenderJob") || "").trim();
  const cloudRenderToken = String(cloudRenderParams.get("cloudRenderToken") || "").trim();
  const isCloudRenderMode = Boolean(cloudRenderJobId && cloudRenderToken);
  const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
  const pageVersion = pageParams.get("v");
  const contextVersion = pageVersion ? `?v=${encodeURIComponent(pageVersion)}` : "";
  const knownClientContexts = new Set(["agnes", "corine", "elie"]);
  const requestedClientContext = String(pageParams.get("client") || "").trim().toLowerCase();
  if (!isLocalHost && !requestedClientContext && !pageParams.get("context")) {
    const accountLanding = new URL("./", window.location.href);
    if (pageVersion) accountLanding.searchParams.set("v", pageVersion);
    accountLanding.searchParams.set("account", "1");
    window.location.replace(accountLanding.href);
    return;
  }
  const defaultClientContext = knownClientContexts.has(requestedClientContext) ? requestedClientContext : "elie";
  const defaultLocalContext = `./tmp/real-estate-import/${defaultClientContext}/app-context.js${contextVersion}`;
  const defaultPublicContext = `./assets/real-estate/${defaultClientContext}/app-context.js${contextVersion}`;
  const contextParam = pageParams.get("context");
  const contextUrl = contextParam || (isLocalHost ? defaultLocalContext : defaultPublicContext);
  const pdfFormatKey = "photosbyelie-real-estate-pdf-format";
  const pdfOrientationKey = "photosbyelie-real-estate-pdf-orientation";
  const slideshowPhotoSecondsKey = "photosbyelie-real-estate-slideshow-photo-seconds";
  const slideshowOrientationKey = "photosbyelie-real-estate-slideshow-orientation";
  const slideshowMusicCountryKey = "photosbyelie-real-estate-slideshow-music-country";
  const watermarkKey = "photosbyelie-real-estate-watermark";
  const watermarkTextKey = "photosbyelie-real-estate-watermark-text";

  const clearLogoutFromHistory = () => {
    if (!pageParams.has("logout") && !pageParams.has("access")) return;
    pageParams.delete("logout");
    pageParams.delete("access");
    if (!window.history?.replaceState) return;
    try {
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete("logout");
      cleanUrl.searchParams.delete("access");
      window.history.replaceState(window.history.state, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
    } catch {
      // The current session is valid even if a browser blocks history cleanup.
    }
  };

  const wizardStepSlugs = ["shoots", "photos", "titles", "order", "output"];
  const wizardStepSlugFor = (step) => wizardStepSlugs[normalizeWizardStep(step)] || "shoots";
  const wizardStepFromSlug = (value) => {
    const normalized = String(value || "").trim().toLowerCase();
    const index = wizardStepSlugs.indexOf(normalized);
    return index >= 0 ? index : null;
  };
  const requestedWizardStepFromUrl = () => {
    const fromParam = wizardStepFromSlug(pageParams.get("step"));
    if (fromParam !== null) return fromParam;
    const fromHash = wizardStepFromSlug(String(window.location.hash || "").replace(/^#/, "").replace(/^real-estate-/, ""));
    return fromHash;
  };
  const replaceWizardStepInUrl = (step) => {
    if (!window.history?.replaceState) return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("step", wizardStepSlugFor(step));
      url.hash = step === 4 ? "real-estate-output-title" : "real-estate-wizard";
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    } catch {
      // Browsers can block history writes in unusual embedded contexts.
    }
  };
  const previewReturnUrl = () => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("logout");
      url.searchParams.delete("access");
      url.searchParams.set("step", "output");
      url.hash = "real-estate-output-title";
      return `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return `./real-estate.html${contextVersion}#real-estate-output-title`;
    }
  };

  const elements = {
    login: app.querySelector("[data-re-login]"),
    loginForm: app.querySelector("[data-re-login-form]"),
    loginCustomer: app.querySelector("[data-re-login-customer]"),
    loginName: app.querySelector("[data-re-login-name]"),
    loginCode: app.querySelector("[data-re-login-code]"),
    loginCodeToggle: app.querySelector("[data-re-toggle-code]"),
    loginCodeIcon: app.querySelector("[data-re-code-icon]"),
    loginGoogle: app.querySelector("[data-re-google-login]"),
    loginStatus: app.querySelector("[data-re-login-status]"),
    customer: app.querySelector("[data-re-customer]"),
    title: app.querySelector("[data-re-title]"),
    activeProductLabel: app.querySelector("[data-re-active-product-label]"),
    activeProductName: app.querySelector("[data-re-active-product-name]"),
    description: app.querySelector("[data-re-description]"),
    deliverablesPanel: app.querySelector("[data-re-deliverables-panel]"),
    deliverablesList: app.querySelector("[data-re-deliverables-list]"),
    total: app.querySelector("[data-re-total]"),
    videoTotal: app.querySelector("[data-re-video-total]"),
    albumTotal: app.querySelector("[data-re-album-total]"),
    selectedTotal: app.querySelector("[data-re-selected-total]"),
    albums: app.querySelector("[data-re-albums]"),
    filterForm: app.querySelector("[data-re-filter-form]"),
    search: app.querySelector("[data-re-search]"),
    sort: app.querySelector("[data-re-sort]"),
    mediaType: app.querySelector("[data-re-media-type]"),
    selectedOnly: app.querySelector("[data-re-selected-only]"),
    slideshowMusicCountry: app.querySelector("[data-re-slideshow-music-country]"),
    watermarkEnabled: app.querySelector("[data-re-watermark-enabled]"),
    watermarkText: app.querySelector("[data-re-watermark-text]"),
    status: app.querySelector("[data-re-status]"),
    draftCount: app.querySelector("[data-re-draft-count]"),
    draftList: app.querySelector("[data-re-draft-list]"),
    grid: app.querySelector("[data-re-grid]"),
    actionBarSelected: document.querySelector("[data-re-selected-bar]"),
    actionStatus: document.querySelector("[data-re-action-status]"),
    dialog: document.querySelector("[data-re-dialog]"),
    dialogFigure: document.querySelector("[data-re-dialog-figure]"),
    dialogImage: document.querySelector("[data-re-dialog-image]"),
    dialogAlbum: document.querySelector("[data-re-dialog-album]"),
    dialogTitle: document.querySelector("[data-re-dialog-title]"),
    dialogTitleInput: document.querySelector("[data-re-dialog-title-input]"),
    dialogSelected: document.querySelector("[data-re-dialog-selected]"),
    dialogDetails: document.querySelector("[data-re-dialog-details]"),
    helpDialog: document.querySelector("[data-re-help-dialog]"),
    originalsDialog: document.querySelector("[data-re-originals-dialog]"),
    originalsForm: document.querySelector("[data-re-originals-form]"),
    originalsCode: document.querySelector("[data-re-originals-code]"),
    originalsStatus: document.querySelector("[data-re-originals-status]"),
    actionBar: document.querySelector("[data-re-action-bar]"),
    wizard: app.querySelector("[data-re-wizard]"),
    wizardStatus: app.querySelector("[data-re-wizard-status]"),
    outputPanel: app.querySelector("[data-re-output-panel]"),
    outputPdf: app.querySelector("[data-re-output-pdf]"),
    outputVideo: app.querySelector("[data-re-output-video]"),
    outputProgress: app.querySelector("[data-re-output-progress]"),
    outputProgressTitle: app.querySelector("[data-re-output-progress-title]"),
    outputProgressEta: app.querySelector("[data-re-output-progress-eta]"),
    outputProgressBar: app.querySelector("[data-re-output-progress-bar]"),
    outputProgressDetail: app.querySelector("[data-re-output-progress-detail]"),
  };

  const state = {
    payload: null,
    gallery: null,
    photos: [],
    photosById: new Map(),
    albums: [],
    album: "all",
    shootFilters: [],
    detailMode: false,
    wizardStep: 0,
    query: "",
    mediaType: "all",
    sort: "album",
    density: "balanced",
    pdfFormat: localStorage.getItem(pdfFormatKey) || "a4",
    pdfOrientation: localStorage.getItem(pdfOrientationKey) || "portrait",
    slideshowPhotoSeconds: [3, 4, 5].includes(Number(localStorage.getItem(slideshowPhotoSecondsKey)))
      ? Number(localStorage.getItem(slideshowPhotoSecondsKey))
      : 4,
    slideshowOrientation: localStorage.getItem(slideshowOrientationKey) || "landscape",
    slideshowMusicCountry: localStorage.getItem(slideshowMusicCountryKey) || "auto",
    slideshowMusicTracks: [],
    slideshowMusicManifestLoaded: false,
    slideshowMusicManifestError: "",
    watermarkEnabled: localStorage.getItem(watermarkKey) !== "off",
    watermarkText: localStorage.getItem(watermarkTextKey) || "",
    selectedOnly: false,
    selectedOrder: [],
    selectedIds: new Set(),
    editedTitles: {},
    projectAssignments: {},
    activeDeliverableId: "",
    activeDeliverableName: "",
    activeDeliverableNameEdited: false,
    editingDeliverableNameId: "",
    localDeliverables: [],
    cloudDeliverables: [],
    cloudDeliverablesBusy: false,
    cloudDeliverablesLoaded: false,
    cloudDeliverablesError: "",
    activePhotoId: "",
    lastRangePhotoId: "",
    dragDraftId: "",
    pointerDraftId: "",
    pointerDraftStartX: 0,
    pointerDraftStartY: 0,
    pointerDraftActive: false,
    unlocked: false,
    pdfBusy: false,
    outputBusy: false,
    outputBusyKind: "",
    outputProgressStartedAt: 0,
    outputProgressHideTimer: 0,
    videoExportCache: null,
    videoExportCacheKey: "",
    videoExportPromise: null,
    videoExportAbort: null,
    videoExportStatus: "idle",
    videoExportError: "",
    videoExportTimer: 0,
    videoExportToken: 0,
    originalsBusy: false,
    originalsCredentialRequest: null,
    username: "",
    accessCode: "",
  };

  const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[char]));

  const replaceTokens = (text, replacements = {}) => Object.entries(replacements).reduce(
    (value, [name, replacement]) => value.replaceAll(`{${name}}`, String(replacement ?? "")),
    String(text || "")
  );

  const t = (keyName, replacements = {}, fallback = "") => {
    const value = window.photosByElieI18n?.t?.(keyName, replacements);
    if (value && value !== keyName) return value;
    return replaceTokens(fallback || keyName, replacements);
  };

  const reIcon = (name) => {
    const paths = {
      edit: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm2 1.58.63-2.52 8.43-8.43 1.06 1.06-8.43 8.43L5 18.83zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
      trash: "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM8 9h8v10H8V9zm7.5-5-1-1h-5l-1 1H5v2h14V4h-3.5z",
    };
    const path = paths[name];
    if (!path) return window.photosByElieMdIcon?.(name) || "";
    return `<svg class="md-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${path}"></path></svg>`;
  };

  const safeUrl = (value) => {
    const raw = String(value || "");
    if (!raw) return "";
    try {
      const url = new URL(raw, window.location.href);
      if (url.origin !== window.location.origin && !/^https?:$/.test(url.protocol)) return "";
      return url.href;
    } catch {
      return raw;
    }
  };

  const publicMediaUrl = (key) => {
    const cleanKey = String(key || "").replace(/^\/+/, "");
    const baseUrl = String(window.photosByElieMediaConfig?.publicBaseUrl || "").replace(/\/+$/, "");
    return cleanKey && baseUrl ? `${baseUrl}/${cleanKey}` : "";
  };

  const normalizedWorkerBase = (value) => {
    const raw = String(value || "").trim().replace(/\/+$/, "");
    if (!raw) return "";
    try {
      const url = new URL(raw, window.location.href);
      return /^https?:$/.test(url.protocol) ? url.href.replace(/\/+$/, "") : "";
    } catch {
      return "";
    }
  };

  const workerBaseUrl = () => {
    const override = normalizedWorkerBase(pageParams.get("authWorkerBase") || pageParams.get("workerBase"));
    if (override) return override;
    const configured = normalizedWorkerBase(
      window.photosByElieMediaConfig?.authWorkerBaseUrl
      || window.photosByElieMediaConfig?.checkoutWorkerBaseUrl
      || ""
    );
    if (configured) return configured;
    return isLocalHost ? "http://localhost:8787" : "";
  };

  const workerMediaUrl = (key) => {
    const cleanKey = String(key || "").replace(/^\/+/, "");
    const baseUrl = workerBaseUrl();
    return cleanKey && baseUrl ? `${baseUrl}/media/${cleanKey.split("/").map(encodeURIComponent).join("/")}` : "";
  };

  const loadScript = (src) => new Promise((resolve, reject) => {
    if (!src) {
      reject(new Error("No real-estate context script configured."));
      return;
    }
    let url;
    try {
      url = new URL(src, window.location.href);
    } catch (error) {
      reject(error);
      return;
    }
    if (url.origin !== window.location.origin) {
      reject(new Error("Real-estate context must be served from this site."));
      return;
    }
    const script = document.createElement("script");
    script.src = url.href;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Could not load ${url.pathname}`));
    document.head.append(script);
  });

  const readJson = (key, fallback) => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "null");
      return value == null ? fallback : value;
    } catch {
      return fallback;
    }
  };

  const writeJson = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  };

  const readStorageFlag = (key) => {
    try {
      if (JSON.parse(localStorage.getItem(key) || "false")) return true;
    } catch {}
    try {
      if (JSON.parse(sessionStorage.getItem(key) || "false")) return true;
    } catch {}
    try {
      return document.cookie
        .split(";")
        .map((item) => item.trim())
        .includes(`${encodeURIComponent(key)}=1`);
    } catch {
      return false;
    }
  };

  const writeStorageFlag = (key) => {
    try {
      localStorage.setItem(key, "true");
    } catch {}
    try {
      sessionStorage.setItem(key, "true");
    } catch {}
    try {
      document.cookie = `${encodeURIComponent(key)}=1; max-age=31536000; path=/; SameSite=Lax`;
    } catch {}
  };

  const workflow = () => state.payload?.cloudPdfWorkflow || {};
  const selectionStoreKey = () => workflow().selectionStoreKey || `photosbyelie-real-estate-liked-${state.gallery?.key || "default"}`;
  const titleStoreKey = () => workflow().titleStoreKey || `photosbyelie-real-estate-titles-${state.gallery?.key || "default"}`;
  const projectStoreKey = () => workflow().projectStoreKey || `photosbyelie-real-estate-projects-${state.gallery?.key || "default"}`;
  const authStoreKey = () => `photosbyelie-real-estate-session-${state.gallery?.key || "default"}`;
  const credentialSessionKey = () => `photosbyelie-real-estate-credentials-${state.gallery?.key || "default"}`;
  const helpDismissedGlobalKey = "photosbyelie-real-estate-help-dismissed";
  const helpDismissedKey = () => `photosbyelie-real-estate-help-dismissed-${state.gallery?.key || "default"}`;
  const localDeliverablesStoreKey = () => `photosbyelie-real-estate-products-${state.gallery?.key || "default"}`;

  const readSessionCredentials = () => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(credentialSessionKey()) || "null");
      return saved && typeof saved === "object" ? saved : {};
    } catch {
      return {};
    }
  };

  const writeSessionCredentials = (username, accessCode) => {
    state.username = String(username || "");
    state.accessCode = "";
    try {
      sessionStorage.setItem(credentialSessionKey(), JSON.stringify({
        username: state.username,
      }));
    } catch {}
  };

  const clearSessionCredentials = () => {
    state.username = "";
    state.accessCode = "";
    try {
      sessionStorage.removeItem(credentialSessionKey());
    } catch {}
  };

  const openDialog = (dialog) => {
    if (!dialog) return;
    if (typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
  };

  const closeDialog = (dialog) => {
    if (!dialog) return;
    if (typeof dialog.close === "function") {
      dialog.close();
    } else {
      dialog.removeAttribute("open");
    }
  };

  const showHelp = ({ force = false } = {}) => {
    if (!elements.helpDialog || !state.unlocked) return;
    const alreadyDismissed = readStorageFlag(helpDismissedGlobalKey) || readStorageFlag(helpDismissedKey());
    if (!force && (alreadyDismissed || state.selectedOrder.length > 0)) return;
    if (!force) {
      writeStorageFlag(helpDismissedGlobalKey);
      writeStorageFlag(helpDismissedKey());
    }
    openDialog(elements.helpDialog);
  };

  const dismissHelp = () => {
    writeStorageFlag(helpDismissedGlobalKey);
    writeStorageFlag(helpDismissedKey());
    closeDialog(elements.helpDialog);
  };

  const abortError = (message) => Object.assign(new Error(message), { name: "AbortError" });

  const promptOriginalsPassword = (message = "") => new Promise((resolve, reject) => {
    if (!elements.originalsDialog || !elements.originalsCode || !elements.originalsForm) {
      const accessCode = "";
      reject(abortError("Originals ZIP canceled"));
      return accessCode;
    }
    if (state.originalsCredentialRequest?.reject) {
      state.originalsCredentialRequest.reject(abortError("Originals ZIP canceled"));
    }
    state.originalsCredentialRequest = { resolve, reject };
    elements.originalsCode.value = "";
    if (elements.originalsStatus) {
      elements.originalsStatus.textContent = message || "Enter the client password to prepare the private originals ZIP.";
    }
    openDialog(elements.originalsDialog);
    window.setTimeout(() => elements.originalsCode?.focus(), 80);
  });

  const completeOriginalsPassword = () => {
    const request = state.originalsCredentialRequest;
    if (!request) return;
    const accessCode = String(elements.originalsCode?.value || "").trim();
    if (!accessCode) {
      if (elements.originalsStatus) elements.originalsStatus.textContent = "Enter the client password.";
      elements.originalsCode?.focus();
      return;
    }
    state.originalsCredentialRequest = null;
    closeDialog(elements.originalsDialog);
    request.resolve(accessCode);
  };

  const cancelOriginalsPassword = () => {
    const request = state.originalsCredentialRequest;
    state.originalsCredentialRequest = null;
    closeDialog(elements.originalsDialog);
    if (request?.reject) request.reject(abortError("Originals ZIP canceled"));
  };

  const normalizeCredential = (value) => String(value || "").trim().toLowerCase();
  const expectedLoginNames = () => new Set([
    state.payload?.customer?.username,
    state.payload?.customer?.email,
    state.payload?.customer?.name,
  ].map(normalizeCredential).filter(Boolean));
  const hasUnlockedSession = () => {
    const saved = readJson(authStoreKey(), {});
    return Boolean(
      saved?.unlocked
      && saved?.galleryKey === state.gallery?.key
      && expectedLoginNames().has(normalizeCredential(saved?.username))
    );
  };

  const writeSession = (username = "") => writeJson(authStoreKey(), {
    galleryKey: state.gallery?.key || "",
    username,
    unlocked: true,
    unlockedAt: new Date().toISOString(),
  });

  const clearAuthState = () => {
    try {
      localStorage.removeItem(authStoreKey());
    } catch {}
    clearSessionCredentials();
    state.unlocked = false;
    state.accessCode = "";
  };

  const realEstateWorkerError = (response, body = {}) => {
    const message = body?.error?.message || "Real Estate Worker request failed.";
    const error = new Error(message);
    error.status = response.status;
    error.code = body?.error?.code || "real_estate_worker_error";
    return error;
  };

  const handleAuthFailure = (error) => {
    if (error?.status !== 401 && error?.code !== "real_estate_login_required") return false;
    clearAuthState();
    syncAuthUi();
    if (elements.loginStatus) elements.loginStatus.textContent = "Your login expired. Please log in again.";
    return true;
  };

  const loginWithWorker = async (username, accessCode) => {
    const baseUrl = workerBaseUrl();
    if (!baseUrl) throw new Error("Client login needs the Photos By Elie Worker.");
    const response = await fetch(`${baseUrl}/real-estate/login`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        galleryKey: state.gallery?.key || "",
        username,
        accessCode,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw realEstateWorkerError(response, body);
    return body.session || {};
  };

  const accessLoginReturnUrl = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("logout");
    url.searchParams.set("access", "1");
    return url.href;
  };

  const siteSignInUrl = () => {
    const url = new URL("./", window.location.href);
    if (pageVersion) url.searchParams.set("v", pageVersion);
    url.searchParams.set("account", "1");
    url.searchParams.set("accountMode", "signin");
    return url.href;
  };

  const redirectToAccessLogin = () => {
    const baseUrl = workerBaseUrl();
    if (!baseUrl) throw new Error("Google login needs the Photos By Elie Worker.");
    const loginUrl = new URL(`${baseUrl}/auth/google/login`);
    loginUrl.searchParams.set("returnTo", accessLoginReturnUrl());
    loginUrl.searchParams.set("intent", "real-estate");
    loginUrl.searchParams.set("prompt", "select_account");
    if (elements.loginStatus) elements.loginStatus.textContent = "Opening Google sign-in...";
    window.location.href = loginUrl.href;
  };

  const loginWithAccess = async ({ redirectOnUnauthorized = false } = {}) => {
    const baseUrl = workerBaseUrl();
    if (!baseUrl) throw new Error("Google login needs the Photos By Elie Worker.");
    const response = await fetch(`${baseUrl}/real-estate/access-login`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        galleryKey: state.gallery?.key || "",
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (redirectOnUnauthorized && (response.status === 401 || body?.error?.code === "access_login_required")) {
        redirectToAccessLogin();
        return null;
      }
      throw realEstateWorkerError(response, body);
    }
    return body || {};
  };

  const unlockFromAccessLogin = async ({ redirectOnUnauthorized = false } = {}) => {
    const result = await loginWithAccess({ redirectOnUnauthorized });
    if (!result) return false;
    const session = result.session || {};
    const username = session.username || result.access?.user?.email || state.payload?.customer?.username || state.payload?.customer?.name || "";
    state.unlocked = true;
    if (elements.loginCode) elements.loginCode.value = "";
    if (elements.loginName && username) elements.loginName.value = username;
    writeSessionCredentials(username);
    writeSession(username);
    clearLogoutFromHistory();
    syncAuthUi();
    setStatus(`${state.photos.length} visible / ${state.photos.length} media`);
    fetchCloudDeliverables({ quiet: true }).catch(() => {});
    scheduleVideoExportSynthesis(1000);
    window.setTimeout(() => showHelp(), 120);
    return true;
  };

  const renderLoginCodeIcon = () => {
    const showing = elements.loginCode?.type === "text";
    const fallbackIcon = (name) => {
      const paths = {
        visibility: "M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zm0 12.5c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z",
        visibilityOff: "M12 6.5c3.79 0 7.17 2.13 8.82 5.5-.7 1.43-1.79 2.62-3.08 3.49L19.16 16.91C20.69 15.88 22 14.2 23 12c-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l1.65 1.65c.74-.23 1.52-.35 2.33-.35zM2.1 3.27.82 4.55l3.01 3.01C2.67 8.68 1.7 10.19 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l3.07 3.07 1.27-1.27L2.1 3.27zm7.53 7.53 1.55 1.55c-.11-.39-.02-.82.29-1.13.31-.31.74-.4 1.13-.29l-1.55-1.55c.31-.08.63-.12.95-.12 1.66 0 3 1.34 3 3 0 .32-.04.64-.12.95l1.54 1.54c.37-.68.58-1.45.58-2.29 0-2.76-2.24-5-5-5-.84 0-1.61.21-2.29.58zm2.37 6.2c-2.76 0-5-2.24-5-5 0-.84.21-1.61.58-2.29l1.54 1.54c-.08.31-.12.63-.12.95 0 1.66 1.34 3 3 3 .32 0 .64-.04.95-.12l1.54 1.54c-.68.37-1.45.58-2.29.58z",
      };
      return `<svg class="md-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${paths[name]}"></path></svg>`;
    };
    if (elements.loginCodeIcon) {
      const name = showing ? "visibilityOff" : "visibility";
      elements.loginCodeIcon.innerHTML = window.photosByElieMdIcon?.(name) || fallbackIcon(name);
    }
    if (elements.loginCodeToggle) {
      elements.loginCodeToggle.setAttribute("aria-label", showing
        ? t("re.login.hide_password", {}, "Hide password")
        : t("re.login.show_password", {}, "Show password"));
      elements.loginCodeToggle.setAttribute("aria-pressed", String(showing));
    }
  };

  const syncSiteAccountSession = () => {
    const account = window.photosByElieAccount;
    if (!account) return;
    if (state.unlocked) {
      account.setScopedSession?.({
        kind: "real-estate",
        label: state.username || state.payload?.customer?.name || state.payload?.customer?.username || "",
      });
      return;
    }
    account.clearScopedSession?.("real-estate");
  };

  const syncAuthUi = () => {
    app.classList.toggle("is-locked", !state.unlocked);
    app.classList.toggle("is-shelf-mode", state.unlocked && !state.detailMode);
    app.classList.toggle("is-detail-mode", state.unlocked && state.detailMode);
    if (elements.actionBar) elements.actionBar.hidden = !state.unlocked || !state.detailMode;
    if (elements.loginStatus && state.unlocked) elements.loginStatus.textContent = "";
    if (!state.unlocked && elements.loginCode) {
      elements.loginCode.value = "";
      elements.loginCode.type = "password";
    }
    renderLoginCodeIcon();
    syncSiteAccountSession();
  };

  const requireUnlocked = () => {
    if (state.unlocked) return true;
    if (elements.loginStatus) elements.loginStatus.textContent = "Enter the client credentials to open this review.";
    syncAuthUi();
    window.scrollTo({ top: 0, behavior: "smooth" });
    return false;
  };

  const imageFor = (photo, size = "gallery") => {
    const preview = photo?.media?.publicPreview || {};
    const remoteUrl = size === "detail"
      ? publicMediaUrl(preview.detailKey || photo?.cloudPdfSource?.publicKey)
      : publicMediaUrl(preview.galleryKey);
    if (!isLocalHost && remoteUrl) return remoteUrl;
    return safeUrl(
      size === "detail"
        ? preview.detailUrl || preview.previewUrl || photo?.imageSrc || preview.galleryUrl || photo?.gallerySrc
        : preview.galleryUrl || preview.thumbnailUrl || photo?.gallerySrc || preview.detailUrl || photo?.imageSrc
    );
  };

  const videoPreviewFor = (photo) => {
    const preview = photo?.media?.publicPreview || {};
    const remoteUrl = publicMediaUrl(
      preview.detailVideoKey
      || preview.videoKey
      || preview.previewVideoKey
      || photo?.media?.video?.publicPreviewKey
    );
    if (!isLocalHost && remoteUrl) return remoteUrl;
    return safeUrl(
      preview.detailVideoUrl
      || preview.videoUrl
      || preview.previewVideoUrl
      || photo?.media?.video?.previewUrl
      || ""
    );
  };

  const mediaTypeFor = (photo) => String(photo?.media?.type || photo?.mediaType || "photo").toLowerCase() === "video" ? "video" : "photo";
  const isVideo = (photo) => mediaTypeFor(photo) === "video";
  const mediaLabelFor = (photo) => isVideo(photo) ? "Video" : "Photo";
  const videoStillPercentFor = (photo) => Number(photo?.cloudPdfSource?.videoStillPercent || photo?.media?.video?.posterPercent || 10) || 10;
  const durationSecondsFor = (photo) => {
    const direct = Number(
      photo?.media?.video?.durationSeconds
      ?? photo?.media?.video?.duration
      ?? photo?.realEstate?.videoDurationSeconds
      ?? photo?.durationSeconds
      ?? 0
    );
    if (Number.isFinite(direct) && direct > 0) return direct;
    const text = (photo?.metadata || []).map((item) => `${item.label} ${item.value}`).join(" ");
    const match = text.match(/(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b/i);
    return match ? Number(match[1]) || 0 : 0;
  };

  const formatDuration = (seconds) => {
    const value = Math.max(0, Number(seconds) || 0);
    if (!value) return "";
    const minutes = Math.floor(value / 60);
    const remainder = Math.round(value % 60);
    if (!minutes) return `${remainder}s`;
    return `${minutes}:${String(remainder).padStart(2, "0")}`;
  };

  const albumTitleFor = (photo) => photo?.albumTitle || photo?.caption || photo?.album || "Property";
  const stripPropertyTitlePrefix = (photo, title) => {
    const albumTitle = String(albumTitleFor(photo) || "").trim();
    const rawTitle = String(title || "").trim();
    if (!albumTitle || !rawTitle) return rawTitle;
    const prefix = `${albumTitle} - `;
    return rawTitle.toLowerCase().startsWith(prefix.toLowerCase())
      ? rawTitle.slice(prefix.length).trim()
      : rawTitle;
  };
  const defaultTitleFor = (photo) => stripPropertyTitlePrefix(photo, photo?.editableTitle || photo?.title || photo?.id || "");
  const titleFor = (photo) => stripPropertyTitlePrefix(photo, state.editedTitles[photo?.id] || defaultTitleFor(photo));
  const projectIdFor = (photo) => photo?.albumSlug || "project";
  const projectTitleFor = (photo) => albumTitleFor(photo);
  const projectOptions = () => state.albums.map((album, index) => ({
    projectId: album.slug,
    projectTitle: album.displayTitle || album.title || album.slug,
    sortIndex: Number(album.sortIndex) || index + 1,
  }));
  const projectOptionFor = (projectId, photo) => (
    projectOptions().find((project) => project.projectId === projectId)
    || {
      projectId,
      projectTitle: projectTitleFor(photo),
      sortIndex: projectOptions().length + 1,
    }
  );
  const assignedProjectIdsFor = (photo) => {
    const knownProjectIds = new Set(projectOptions().map((project) => project.projectId));
    const saved = Array.isArray(state.projectAssignments[photo?.id]) ? state.projectAssignments[photo.id] : [];
    const sourceProject = projectIdFor(photo);
    const ids = (saved.length ? saved : [sourceProject])
      .filter((projectId, index, items) => projectId && items.indexOf(projectId) === index)
      .filter((projectId) => knownProjectIds.has(projectId) || projectId === sourceProject);
    return ids.length ? ids : [sourceProject];
  };
  const fileSlug = (value) => String(value || "project")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "project";
  const paperFormats = {
    a4: { key: "a4", label: "A4", width: 595.28, height: 841.89 },
    letter: { key: "letter", label: "Letter", width: 612, height: 792 },
  };
  const pdfOrientationOptions = new Set(["landscape", "portrait"]);
  const normalizePdfOrientation = (value) => pdfOrientationOptions.has(value) ? value : "portrait";
  const paperFormatFor = (key = state.pdfFormat, orientation = state.pdfOrientation) => {
    const paper = paperFormats[key] || paperFormats.a4;
    const normalizedOrientation = normalizePdfOrientation(orientation);
    return normalizedOrientation === "landscape"
      ? { ...paper, label: `${paper.label} landscape`, width: paper.height, height: paper.width, orientation: normalizedOrientation }
      : { ...paper, orientation: normalizedOrientation };
  };
  const pdfWatermarkText = "\u00a9 2026 Photos By Elie";
  const slideshowOrientationOptions = new Set(["landscape", "portrait"]);
  const slideshowMusicCountries = Object.freeze(["Spain", "Portugal", "France", "USA"]);
  const slideshowMusicCountryOptions = new Set(["auto", ...slideshowMusicCountries]);
  const normalizeSlideshowOrientation = (value) => slideshowOrientationOptions.has(value) ? value : "landscape";
  const normalizeSlideshowMusicCountry = (value) => {
    const raw = String(value || "").trim();
    return slideshowMusicCountryOptions.has(raw) ? raw : "auto";
  };
  const activeWatermarkText = () => state.watermarkEnabled ? (String(state.watermarkText || "").trim() || pdfWatermarkText) : "";
  const slideshowTransition = "subtle-centered-ken-burns";
  const slideshowMusicSourceManifestPath = "assets/music/slideshow-guitar/pixabay/pixabay-guitar-candidates.json";
  const slideshowMusicPreparedManifestKey = "assets/music/slideshow-guitar/pixabay/pixabay-guitar-candidates-prepared-060s.json";
  const slideshowMusicManifestUrl = isLocalHost
    ? `./${slideshowMusicSourceManifestPath}${contextVersion}`
    : `${workerMediaUrl(slideshowMusicPreparedManifestKey)}${contextVersion}`;
  const slideshowMusicGainDb = 0;
  const sourceVideoAudioGainDb = -20;
  const sourceVideoAudioLinearGain = 10 ** (sourceVideoAudioGainDb / 20);
  const slideshowMusicMaxDecodeSeconds = 60.25;
  const slideshowVideoFps = 30;
  const slideshowIntroDurationMs = 2200;
  const slideshowOutroDurationMs = 2200;
  const slideshowTransitionFraction = 0.12;
  const slideshowAssetTimeoutMs = 12000;
  const slideshowVideoMimeTypes = Object.freeze([
    "video/mp4;codecs=h264,aac",
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ]);
  const trackPublicKey = (track) => (
    String(track?.r2Key || track?.publicKey || track?.src || "")
      .replace(/^\.\//, "")
      .replace(/^\/+/, "")
  );
  const absoluteTrackUrl = (track) => {
    if (!track?.src) return "";
    try {
      return new URL(track.src, window.location.href).href;
    } catch {
      return track.src;
    }
  };
  const workerTrackUrl = (track) => workerMediaUrl(trackPublicKey(track));
  const withAbsoluteTrackUrl = (track) => {
    if (!track) return null;
    const publicKey = trackPublicKey(track);
    return {
      ...track,
      publicKey,
      absoluteSrc: isLocalHost ? absoluteTrackUrl(track) : (workerTrackUrl(track) || absoluteTrackUrl(track)),
    };
  };
  const textIncludesCountry = (text, country) => {
    const normalized = String(text || "").toLowerCase();
    if (!normalized) return false;
    const aliases = {
      Spain: ["spain", "spanish", "espagne", "espana", "españa", "madrid", "barcelona", "valencia", "andalusia", "andalucia"],
      Portugal: ["portugal", "portuguese", "lisbon", "lisboa", "porto", "sintra"],
      France: ["france", "french", "paris", "albi", "rueil", "malmaison"],
      USA: ["usa", "u.s.a", "united states", "america", "american", "new york", "california"],
    }[country] || [country.toLowerCase()];
    return aliases.some((alias) => normalized.includes(alias));
  };
  const inferSlideshowMusicCountry = (photos = activeSelectedPhotos()) => {
    const text = [
      state.gallery?.key,
      state.gallery?.title,
      state.payload?.customer?.name,
      ...projectGroupsFor(photos, true).flatMap((project) => [project.projectId, project.projectTitle]),
      ...photos.flatMap((photo) => [photo?.albumSlug, photo?.albumTitle, photo?.album, photo?.caption, photo?.country, photo?.collection]),
    ].filter(Boolean).join(" ");
    return slideshowMusicCountries.find((country) => textIncludesCountry(text, country)) || "Spain";
  };
  const activeSlideshowMusicCountry = (photos = activeSelectedPhotos()) => (
    state.slideshowMusicCountry === "auto" ? inferSlideshowMusicCountry(photos) : normalizeSlideshowMusicCountry(state.slideshowMusicCountry)
  );
  const chooseSlideshowMusicTrack = (photos = activeSelectedPhotos()) => {
    const country = activeSlideshowMusicCountry(photos);
    const countryTracks = state.slideshowMusicTracks.filter((track) => track.country === country);
    const fallbackTracks = state.slideshowMusicTracks.filter((track) => track.country === "Spain");
    const pool = countryTracks.length ? countryTracks : (fallbackTracks.length ? fallbackTracks : state.slideshowMusicTracks);
    const practicalPool = pool.filter((track) => {
      const duration = Number(track?.duration) || Number(track?.durationSeconds) || 0;
      return duration > 0 && duration <= slideshowMusicMaxDecodeSeconds;
    });
    const eligiblePool = practicalPool.length ? practicalPool : pool;
    const track = eligiblePool[Math.floor(Math.random() * eligiblePool.length)] || null;
    return withAbsoluteTrackUrl(track ? { ...track, selectedCountry: country } : null);
  };
  const slideshowMusicCreditFor = (track) => {
    if (!track) return null;
    const text = String(track.creditText || [
      track.title ? `Music: ${track.title}` : "",
      track.author ? `by ${track.author}` : "",
      track.license ? `(${track.license})` : "",
    ].filter(Boolean).join(" ")).trim();
    if (!text) return null;
    return {
      text,
      required: Boolean(track.creditRequired),
      title: track.title || "",
      author: track.author || "",
      source: track.source || "",
      sourceUrl: track.sourceUrl || "",
      license: track.license || "",
      licenseUrl: track.licenseUrl || "",
    };
  };
  const slideshowMusicCreditsFor = (track) => ({
    renderPolicy: "append-end-card-when-required",
    durationSeconds: 4,
    entries: [slideshowMusicCreditFor(track)].filter(Boolean),
  });
  const slideshowRequiredCreditsFor = (manifest) => {
    const audioPolicy = manifest?.slideshowSettings?.audioPolicy || {};
    const entries = Array.isArray(audioPolicy.musicCredits?.entries) ? audioPolicy.musicCredits.entries : [];
    return entries.filter((entry) => entry?.required && String(entry.text || "").trim());
  };
  const slideshowCreditDurationMsFor = (credits = []) => credits.length
    ? Math.max(3000, Math.min(7000, 2400 + (credits.length * 900)))
    : 0;
  const slideshowAudioPolicyFor = (musicTrack = null) => ({
    selection: "random-from-country-pixabay-pool",
    requestedCountry: state.slideshowMusicCountry,
    resolvedCountry: musicTrack?.selectedCountry || musicTrack?.country || "",
    musicGainDb: slideshowMusicGainDb,
    sourceVideoAudioGainDb,
    sourceVideoAudioLinearGain,
    musicTrack: musicTrack ? { ...musicTrack, musicGainDb: slideshowMusicGainDb } : null,
    musicPool: state.slideshowMusicTracks.map((track) => ({ ...track })),
    musicCredits: slideshowMusicCreditsFor(musicTrack),
  });
  const slideshowSettingsFor = (musicTrack = null) => ({
    mode: "one-slideshow-per-project",
    photoDurationSeconds: state.slideshowPhotoSeconds,
    videoDurationPolicy: "preserve-source-duration",
    outputOrientation: normalizeSlideshowOrientation(state.slideshowOrientation),
    outputAspectRatio: normalizeSlideshowOrientation(state.slideshowOrientation) === "portrait" ? "9:16" : "16:9",
    fitMode: "contain-with-blurred-backdrop",
    playback: "once-no-loop",
    musicFadeOutPolicy: "fade-over-final-slide",
    musicFadeOutSeconds: state.slideshowPhotoSeconds,
    overlayOrder: "watermark-and-counter-before-ken-burns",
    watermarkPolicy: "importer-style-repeating-preview-plus-bottom",
    watermarkEnabled: Boolean(state.watermarkEnabled),
    watermarkText: activeWatermarkText(),
    transition: slideshowTransition,
    effects: "branded-intro-outro-subtle-centered-ken-burns-soft-fades",
    presentation: {
      introDurationMs: slideshowIntroDurationMs,
      outroDurationMs: slideshowOutroDurationMs,
      transition: "soft-fade-through-black",
      branding: "Photos By Elie",
    },
    audioPolicy: slideshowAudioPolicyFor(musicTrack),
  });
  const normalizeSlideshowMusicTrack = (track) => {
    const preparedClip = track?.preparedClip && typeof track.preparedClip === "object"
      ? track.preparedClip
      : null;
    const preparedR2Key = String(preparedClip?.r2Key || "").replace(/^\.?\//, "").trim();
    const src = String(track?.src || "").trim();
    if (!src) return null;
    return {
      ...track,
      sourceSrc: src,
      sourceR2Key: String(track?.r2Key || trackPublicKey(track)),
      ...(preparedR2Key ? {
        src: `./${preparedR2Key}`,
        r2Key: preparedR2Key,
        duration: Number(preparedClip?.duration || preparedClip?.clipSeconds || 60),
        durationSeconds: Number(preparedClip?.duration || preparedClip?.clipSeconds || 60),
      } : {}),
      bpm: Number(track?.bpm) || 0,
      country: slideshowMusicCountries.includes(track?.country) ? track.country : "Spain",
      source: track?.source || "Pixabay",
      license: track?.license || "Pixabay Content License",
      licenseUrl: track?.licenseUrl || "https://pixabay.com/service/license-summary/",
      creditRequired: true,
      creditText: track?.creditText || `Music: "${track?.title || "Pixabay music"}" by ${track?.author || "Pixabay contributor"} via Pixabay`,
      r2Key: preparedR2Key || trackPublicKey(track),
    };
  };
  const loadSlideshowMusicManifest = async () => {
    try {
      const response = await fetch(slideshowMusicManifestUrl, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const manifest = await response.json();
      const tracks = Array.isArray(manifest?.tracks)
        ? manifest.tracks.map(normalizeSlideshowMusicTrack).filter(Boolean)
        : [];
      if (!tracks.length) throw new Error("No slideshow music tracks found");
      state.slideshowMusicTracks = tracks;
      state.slideshowMusicManifestLoaded = true;
      state.slideshowMusicManifestError = "";
      syncSlideshowMusicCountryControls();
      invalidateVideoExportCache({ schedule: state.unlocked });
    } catch (error) {
      state.slideshowMusicTracks = [];
      state.slideshowMusicManifestLoaded = false;
      state.slideshowMusicManifestError = error?.message || "Could not load slideshow music";
      syncSlideshowMusicCountryControls();
      console.warn("Could not load Real Estate slideshow music manifest", error);
    }
  };
  const kenBurnsEffects = Object.freeze([
    "center-breathe-in",
    "center-breathe-out",
    "center-drift-left",
    "center-drift-right",
    "center-drift-up",
    "center-drift-down",
  ]);
  const randomKenBurnsEffect = () => kenBurnsEffects[Math.floor(Math.random() * kenBurnsEffects.length)] || "center-breathe-in";
  const photoSearchText = (photo) => [
    titleFor(photo),
    photo?.title,
    photo?.full,
    photo?.id,
    photo?.album,
    photo?.albumTitle,
    photo?.caption,
    mediaLabelFor(photo),
  ].filter(Boolean).join(" ").toLowerCase();

  const normalizeSelectedOrder = (value) => {
    if (Array.isArray(value)) return value.filter((id) => state.photosById.has(id));
    if (value && Array.isArray(value.photoIds)) return value.photoIds.filter((id) => state.photosById.has(id));
    return [];
  };

  const persistSelection = () => {
    state.selectedOrder = state.selectedOrder.filter((id, index, items) => state.photosById.has(id) && items.indexOf(id) === index);
    state.selectedIds = new Set(state.selectedOrder);
    writeJson(selectionStoreKey(), state.selectedOrder);
  };

  const persistTitles = () => writeJson(titleStoreKey(), state.editedTitles);
  const persistProjectAssignments = () => writeJson(projectStoreKey(), state.projectAssignments);

  const albumForSlug = (slug) => state.albums.find((album) => album.slug === slug);
  const shootTitleFor = (slug) => {
    const album = albumForSlug(slug);
    return album?.displayTitle || album?.title || slug || "Shoot";
  };
  const normalizeShootFilters = (filters = state.shootFilters) => {
    const known = new Set(state.albums.map((album) => album.slug));
    return [...new Set((Array.isArray(filters) ? filters : []).filter((slug) => known.has(slug)))];
  };
  const selectedShootIds = () => {
    const normalized = normalizeShootFilters();
    return normalized;
  };
  const selectedShootSet = () => new Set(selectedShootIds());
  const primaryShootId = () => selectedShootIds()[0] || defaultAlbumSlug();
  const selectedPropertyTitle = () => {
    const shoots = selectedShootIds();
    if (shoots.length === 1) return shootTitleFor(shoots[0]);
    if (shoots.length > 1) return `${shoots.length} shoots`;
    return "selected shoots";
  };

  const updateAutoActiveDeliverableName = () => {
    if (!state.detailMode || state.activeDeliverableId || state.activeDeliverableNameEdited) return;
    state.activeDeliverableName = nextGeneratedDeliverableName("selection", new Date().toISOString(), "", selectedPropertyTitle());
    syncActiveProductName();
  };

  const filteredPhotos = () => {
    const query = state.query.trim().toLowerCase();
    const selectedRank = new Map(state.selectedOrder.map((id, index) => [id, index]));
    const selectedOnly = state.selectedOnly || state.wizardStep === 2;
    const shootSet = selectedShootSet();
    const photos = state.photos.filter((photo) => {
      if (state.wizardStep === 1 && (!shootSet.size || !shootSet.has(photo.albumSlug))) return false;
      if (state.mediaType !== "all" && mediaTypeFor(photo) !== state.mediaType) return false;
      if (selectedOnly && !isSelectedForActiveProject(photo)) return false;
      if (query && !photoSearchText(photo).includes(query)) return false;
      return true;
    });
    return photos.sort((a, b) => {
      if (state.sort === "selected") {
        const ar = selectedRank.has(a.id) ? selectedRank.get(a.id) : Number.MAX_SAFE_INTEGER;
        const br = selectedRank.has(b.id) ? selectedRank.get(b.id) : Number.MAX_SAFE_INTEGER;
        if (ar !== br) return ar - br;
      }
      if (state.sort === "title") return titleFor(a).localeCompare(titleFor(b));
      if (state.sort === "file") return String(a.full || a.id).localeCompare(String(b.full || b.id));
      return (Number(a.sortIndex) || 0) - (Number(b.sortIndex) || 0);
    });
  };

  const setStatus = (message) => {
    if (elements.status) elements.status.textContent = message;
    if (elements.actionStatus) {
      elements.actionStatus.textContent = message;
      elements.actionStatus.title = message;
    }
  };
  const formatEta = (seconds) => {
    const value = Math.max(0, Math.round(Number(seconds) || 0));
    if (!value) return t("re.progress.almost_done", {}, "Almost done");
    if (value < 60) return t("re.progress.seconds_left", { seconds: value }, `${value}s left`);
    const minutes = Math.floor(value / 60);
    const remainder = value % 60;
    return t("re.progress.minutes_left", {
      minutes,
      seconds: String(remainder).padStart(2, "0"),
    }, `${minutes}m ${String(remainder).padStart(2, "0")}s left`);
  };
  const formatBytes = (bytes) => {
    const value = Number(bytes) || 0;
    if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
    if (value >= 1024) return `${Math.round(value / 1024)} KB`;
    return `${value} bytes`;
  };
  const deliverableActionNote = "Open or download on phone or desktop, then save or share with your device tools.";
  const outputProgressEta = (current, total) => {
    if (!state.outputProgressStartedAt || !current || !total || current >= total) return "";
    const elapsed = (Date.now() - state.outputProgressStartedAt) / 1000;
    const secondsPerStep = elapsed / current;
    return formatEta(secondsPerStep * (total - current));
  };
  const updateOutputProgress = ({ title = "", detail = "", current = 0, total = 0, done = false } = {}) => {
    if (!elements.outputProgress) return;
    if (state.outputProgressHideTimer) {
      window.clearTimeout(state.outputProgressHideTimer);
      state.outputProgressHideTimer = 0;
    }
    elements.outputProgress.hidden = false;
    const safeTotal = Math.max(0, Number(total) || 0);
    const safeCurrent = Math.min(safeTotal || Number(current) || 0, Math.max(0, Number(current) || 0));
    if (elements.outputProgressTitle) elements.outputProgressTitle.textContent = title || (done
      ? t("re.progress.done", {}, "Done")
      : t("re.progress.working", {}, "Working..."));
    if (elements.outputProgressDetail) elements.outputProgressDetail.textContent = detail || "";
    if (elements.outputProgressEta) {
      const percent = safeTotal > 0 ? Math.round((safeCurrent / safeTotal) * 100) : 0;
      const eta = done ? "" : outputProgressEta(safeCurrent, safeTotal);
      elements.outputProgressEta.textContent = done ? "" : `${percent}%${eta ? ` · ${eta}` : ""}`;
    }
    if (elements.outputProgressBar) {
      if (safeTotal > 0) {
        elements.outputProgressBar.max = 100;
        elements.outputProgressBar.value = done ? 100 : Math.round((safeCurrent / safeTotal) * 100);
      } else {
        elements.outputProgressBar.removeAttribute("value");
      }
    }
  };
  const startOutputProgress = ({ title = t("re.progress.working", {}, "Working..."), detail = "", total = 0, kind = "output" } = {}) => {
    state.outputBusy = true;
    state.outputBusyKind = kind;
    state.outputProgressStartedAt = Date.now();
    updateOutputProgress({ title, detail, current: 0, total });
    setStatus(detail || title);
    syncFileActionLabels();
  };
  const completeOutputProgress = (detail = t("re.progress.done", {}, "Done")) => {
    updateOutputProgress({ title: t("re.progress.done", {}, "Done"), detail, current: 1, total: 1, done: true });
    state.outputBusy = false;
    state.outputBusyKind = "";
    state.outputProgressStartedAt = 0;
    syncFileActionLabels();
    state.outputProgressHideTimer = window.setTimeout(() => {
      if (elements.outputProgress) elements.outputProgress.hidden = true;
      state.outputProgressHideTimer = 0;
    }, 4500);
  };
  const failOutputProgress = (detail = "Output failed") => {
    updateOutputProgress({ title: t("re.progress.needs_attention", {}, "Needs attention"), detail, current: 0, total: 1 });
    state.outputBusy = false;
    state.outputBusyKind = "";
    state.outputProgressStartedAt = 0;
    syncFileActionLabels();
  };

  const readyCloudDownloadFor = (format) => {
    const normalizedFormat = format === "video" ? "video" : "pdf";
    const selected = activeSelectedPhotos();
    if (!selected.length) return null;
    const currentBatch = normalizedFormat === "video"
      ? buildSlideshowManifest(selected, true)
      : buildBatchManifest(selected, true);
    const fingerprint = batchProductFingerprint(currentBatch);
    const matchesSettings = (record) => {
      const batch = record?.batch || {};
      if (normalizedFormat === "pdf") {
        return paperFormatFor(batch?.pdfSettings?.paperFormat).key === state.pdfFormat
          && normalizePdfOrientation(batch?.pdfSettings?.pageOrientation || "portrait") === normalizePdfOrientation(state.pdfOrientation);
      }
      const settings = batch?.slideshowSettings || {};
      return Number(settings.photoDurationSeconds || 4) === Number(state.slideshowPhotoSeconds)
        && normalizeSlideshowOrientation(settings.outputOrientation || settings.orientation || "landscape") === normalizeSlideshowOrientation(state.slideshowOrientation)
        && normalizeSlideshowMusicCountry(settings.audioPolicy?.requestedCountry || "auto") === normalizeSlideshowMusicCountry(state.slideshowMusicCountry)
        && Boolean(settings.watermarkEnabled) === Boolean(state.watermarkEnabled)
        && String(settings.watermarkText || "") === String(activeWatermarkText() || "");
    };
    return (Array.isArray(state.cloudDeliverables) ? state.cloudDeliverables : [])
      .map(normalizeDeliverable)
      .filter((record) => deliverableFormatCode(record.type) === normalizedFormat)
      .filter((record) => record.status === "ready" && (record.downloadUrl || record.viewUrl))
      .filter((record) => batchProductFingerprint(record.batch) === fingerprint)
      .filter(matchesSettings)
      .sort((left, right) => validDateFor(right.createdAt).getTime() - validDateFor(left.createdAt).getTime())[0] || null;
  };

  const syncDownloadAction = (button, { format, busy, busyLabel, queueLabel, queueTitle, downloadLabel }) => {
    const ready = busy ? null : readyCloudDownloadFor(format);
    const readyUrl = ready?.downloadUrl || ready?.viewUrl || "";
    button.textContent = busy ? busyLabel : (readyUrl ? downloadLabel : queueLabel);
    button.title = readyUrl ? downloadLabel : queueTitle;
    button.dataset.reReadyDownloadUrl = readyUrl;
    button.dataset.reReadyDownloadFilename = ready?.filename || "";
    button.disabled = (state.outputBusy || state.pdfBusy) || activeSelectedPhotos().length === 0;
  };

  const syncFileActionLabels = () => {
    const outputBusy = state.outputBusy || state.pdfBusy;
    const kind = state.outputBusyKind;
    const noActiveSelection = activeSelectedPhotos().length === 0;
    document.querySelectorAll("[data-re-open-outputs]").forEach((button) => {
      button.textContent = outputBusy && kind === "outputs-view"
        ? t("re.progress.working", {}, "Working...")
        : t("re.output.queue_all", {}, "Queue all outputs");
      button.title = "Queue selected PDF and video outputs for cloud assembly";
      button.disabled = outputBusy || noActiveSelection;
    });
    document.querySelectorAll("[data-re-download-outputs]").forEach((button) => {
      button.textContent = outputBusy && kind === "outputs-download"
        ? t("re.output.download_everything_busy", {}, "Queueing everything...")
        : t("re.output.queue_both", {}, "Queue PDF + video");
      button.title = "Send selected PDF and video products to cloud assembly; download links appear on the shelf when ready";
      button.disabled = outputBusy || noActiveSelection;
    });
    document.querySelectorAll("[data-re-view-pdf]").forEach((button) => {
      button.textContent = outputBusy && kind === "pdf-view"
        ? t("re.output.queueing_pdf", {}, "Queueing PDF...")
        : t("re.output.queue_pdf", {}, "Queue PDF");
      button.title = "Queue project PDFs for cloud assembly; selected videos appear as stills from 10% in";
      button.disabled = outputBusy || noActiveSelection;
    });
    document.querySelectorAll("[data-re-download-pdf]").forEach((button) => {
      syncDownloadAction(button, {
        format: "pdf",
        busy: outputBusy && kind === "pdf-download",
        busyLabel: t("re.output.queueing_pdf", {}, "Queueing PDF..."),
        queueLabel: t("re.output.queue_pdf", {}, "Queue PDF"),
        queueTitle: "Queue project PDFs for cloud assembly",
        downloadLabel: t("re.output.download_pdf", {}, "Download PDF"),
      });
    });
    document.querySelectorAll("[data-re-view-slideshow]").forEach((button) => {
      button.textContent = outputBusy && kind === "video-view"
        ? t("re.output.generating_video", {}, "Generating video...")
        : t("re.output.queue_video", {}, "Queue video");
      button.title = "Queue a cloud video with country-matched Pixabay guitar music";
      button.disabled = outputBusy || noActiveSelection;
    });
    document.querySelectorAll("[data-re-download-slideshow]").forEach((button) => {
      syncDownloadAction(button, {
        format: "video",
        busy: outputBusy && kind === "video-download",
        busyLabel: t("re.output.generating_video", {}, "Generating video..."),
        queueLabel: t("re.output.queue_video", {}, "Queue video"),
        queueTitle: "Queue a true slideshow video file in the cloud with source audio ducked under the guitar bed",
        downloadLabel: t("re.output.download_video", {}, "Download video"),
      });
    });
    document.querySelectorAll("[data-re-download-batch]").forEach((button) => {
      button.textContent = outputBusy && kind === "selection"
        ? t("re.output.saving", {}, "Saving...")
        : t("re.action.save_selection", {}, "Save selection");
      button.title = "Save the current selection to the cloud shelf; file sharing remains available as a fallback";
      button.disabled = outputBusy || noActiveSelection;
    });
    document.querySelectorAll("[data-re-download-originals]").forEach((button) => {
      button.textContent = state.originalsBusy
        ? t("re.output.building_originals", {}, "Building originals ZIP...")
        : t("re.output.share_originals", {}, "Share originals ZIP");
      button.title = "Prepare a ZIP of selected original source media from private delivery storage";
      button.disabled = state.originalsBusy || outputBusy || selectedPhotos().length === 0;
    });
    document.querySelectorAll("[data-re-view-deliverable], [data-re-download-deliverable], [data-re-edit-deliverable]").forEach((button) => {
      if (button.matches("[data-re-view-deliverable], [data-re-download-deliverable]") && button.hasAttribute("disabled")) return;
      button.disabled = outputBusy && !button.matches("[data-re-edit-deliverable]");
    });
    document.querySelectorAll("[data-re-load-batch]").forEach((button) => {
      button.textContent = "Load selection file...";
      button.title = "Open a saved selection table or legacy JSON file";
    });
  };

  const isActiveProjectPhoto = (photo) => {
    if (!photo) return false;
    if (!state.album || state.album === "all") return true;
    return photo.albumSlug === state.album || assignedProjectIdsFor(photo).includes(state.album);
  };

  const explicitProjectIdsFor = (photoId) => (
    Array.isArray(state.projectAssignments[photoId])
      ? state.projectAssignments[photoId].filter(Boolean)
      : []
  );

  const selectedProjectIdsFor = (photo) => {
    if (!photo || !state.selectedIds.has(photo.id)) return [];
    const explicit = explicitProjectIdsFor(photo.id);
    return explicit.length ? explicit : [projectIdFor(photo)];
  };

  const isSelectedForActiveProject = (photo) => state.selectedIds.has(photo?.id);

  const activeSelectedPhotos = () => selectedPhotos();

  const defaultAlbumSlug = () => state.albums[0]?.slug || "all";

  const hasPropertyPicker = () => state.albums.length > 1;

  const firstWizardStep = () => 0;

  const normalizeWizardStep = (step) => Math.max(firstWizardStep(), Math.min(4, Number(step) || firstWizardStep()));

  const activeProjectId = () => primaryShootId();

  const renderHero = () => {
    const { gallery, payload, photos } = state;
    const albums = state.albums;
    const products = producedDeliverables();
    const videoCount = photos.filter(isVideo).length;
    const stillCount = Math.max(0, photos.length - videoCount);
    if (elements.loginCustomer) elements.loginCustomer.textContent = t("re.login.eyebrow", {}, "Private client access");
    if (elements.customer) elements.customer.textContent = payload?.customer?.name
      ? t("re.hero.customer_review", { name: payload.customer.name }, `${payload.customer.name} review`)
      : t("re.hero.client_review", {}, "Client review");
    if (elements.title) elements.title.textContent = gallery?.title || t("re.hero.title", {}, "Real estate selection");
    if (elements.description) {
      const description = String(gallery?.description || "");
      const genericDescription = !description || /private real-estate (selection gallery|media review)/i.test(description);
      elements.description.textContent = genericDescription
        ? t("re.hero.description", {}, "Private media review workspace for project PDFs and slideshow delivery.")
        : description;
    }
    if (elements.total) elements.total.textContent = String(stillCount);
    if (elements.total?.previousElementSibling) elements.total.previousElementSibling.textContent = t("re.stats.stills", {}, "Source photos");
    if (elements.videoTotal) elements.videoTotal.textContent = String(videoCount);
    if (elements.albumTotal) elements.albumTotal.textContent = String(albums.length);
    if (elements.selectedTotal) elements.selectedTotal.textContent = String(products.length);
    if (elements.selectedTotal?.previousElementSibling) elements.selectedTotal.previousElementSibling.textContent = t("re.stats.selections", {}, "Saved products");
    syncActiveProductName();
    syncCreateProductButtons(products);
    renderProducedDeliverables();
  };

  const absoluteDeliverableUrl = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (/^\/(?:api\/)?real-estate\//.test(raw)) {
      const baseUrl = workerBaseUrl();
      return baseUrl ? `${baseUrl}${raw}` : "";
    }
    try {
      return new URL(raw, window.location.href).href;
    } catch {
      return raw;
    }
  };

  const cloudCredentialSnapshot = () => {
    const savedCredentials = readSessionCredentials();
    const savedSession = readJson(authStoreKey(), {});
    return {
      username: String(
        state.username
        || savedCredentials.username
        || savedSession.username
        || state.payload?.customer?.username
        || state.payload?.customer?.name
        || ""
      ),
    };
  };

  const deliverableRowsFor = (rows, source) => (Array.isArray(rows) ? rows : []).map((row) => ({
    ...(row && typeof row === "object" ? row : {}),
    __deliverableSource: source,
  }));

  const rawDeliverables = () => [
    ...deliverableRowsFor(state.cloudDeliverables, "cloud"),
    ...deliverableRowsFor(state.localDeliverables, "local"),
    ...deliverableRowsFor(state.payload?.deliverables, "payload"),
    ...deliverableRowsFor(state.gallery?.deliverables, "gallery"),
  ];

  const normalizeDeliverable = (row, index) => {
    const type = String(row?.type || row?.format || row?.kind || "file").toLowerCase();
    const rawStatus = String(row?.status || "ready").toLowerCase().replace("_", "-");
    const ready = !row?.status || ["ready", "complete", "completed", "published"].includes(rawStatus);
    const viewUrl = absoluteDeliverableUrl(row?.viewUrl || row?.watchUrl || row?.url || row?.href);
    const downloadUrl = absoluteDeliverableUrl(row?.downloadUrl || row?.fileUrl || row?.url || row?.href);
    const editUrl = absoluteDeliverableUrl(row?.editUrl || row?.batchUrl || row?.manifestUrl || row?.selectionUrl || row?.sourceBatchUrl);
    return {
      id: String(row?.id || row?.deliverableId || `${type}-${index + 1}`),
      type,
      label: type === "pdf" ? "PDF" : type === "selection" ? "Selection" : type === "video" || type === "mp4" ? "Video" : "File",
      title: String(row?.title || row?.projectTitle || row?.name || `Deliverable ${index + 1}`),
      createdAt: String(row?.createdAt || row?.generatedAt || row?.updatedAt || ""),
      bytes: Number(row?.bytes || row?.size || 0) || 0,
      status: ready ? "ready" : (rawStatus === "failed" ? "needs-attention" : rawStatus),
      failureReason: String(row?.failureReason || row?.assemblyJob?.failureReason || ""),
      viewUrl,
      downloadUrl,
      editUrl,
      batch: row?.batch || row?.manifest || row?.selection || null,
      filename: String(row?.filename || row?.fileName || ""),
      source: String(row?.__deliverableSource || ""),
      raw: row,
    };
  };

  const hashString = (value) => {
    let hash = 5381;
    const text = String(value || "");
    for (let index = 0; index < text.length; index += 1) {
      hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
    }
    return (hash >>> 0).toString(36);
  };

  const batchProductFingerprint = (batch) => {
    const projectRows = Array.isArray(batch?.projects)
      ? batch.projects.flatMap((project, projectIndex) => (
        (Array.isArray(project?.items) ? project.items : []).map((item, itemIndex) => [
          project?.projectId || "",
          project?.projectTitle || "",
          Number(project?.sortIndex) || projectIndex + 1,
          item?.photoId || "",
          Number(item?.sortIndex) || itemIndex + 1,
          item?.title || "",
        ].join(":"))
      ))
      : [];
    const itemRows = projectRows.length
      ? projectRows
      : (Array.isArray(batch?.items) ? batch.items.map((item, itemIndex) => [
        item?.projectId || "",
        item?.projectTitle || "",
        item?.photoId || "",
        Number(item?.sortIndex) || itemIndex + 1,
        item?.title || "",
      ].join(":")) : []);
    return itemRows.length ? itemRows.join("|") : String(batch?.batchId || "");
  };

  const deliverableProductGroupKey = (item) => {
    if (item?.batch) return `batch:${state.gallery?.key || ""}:${batchProductFingerprint(item.batch)}`;
    return `file:${item?.source || ""}:${item?.editUrl || item?.viewUrl || item?.downloadUrl || item?.id || ""}`;
  };

  const deliverableFormatCode = (type) => {
    const normalized = String(type || "").toLowerCase();
    if (normalized === "pdf") return "pdf";
    if (normalized === "video" || normalized === "mp4" || normalized === "slideshow") return "video";
    return "selection";
  };

  const deliverableFormatsLabel = (formats = []) => {
    const ordered = ["pdf", "video", "selection"].filter((format) => formats.includes(format));
    if (ordered.includes("pdf") && ordered.includes("video")) return `PDF + ${t("re.shelf.format_video", {}, "Video")}`;
    if (ordered.includes("pdf")) return "PDF";
    if (ordered.includes("video")) return t("re.shelf.format_video", {}, "Video");
    return `PDF + ${t("re.shelf.format_video", {}, "Video")}`;
  };

  const producedDeliverables = () => {
    const seen = new Set();
    const rows = rawDeliverables()
      .map(normalizeDeliverable)
      .filter((item) => item.title || item.viewUrl || item.downloadUrl || item.editUrl || item.batch)
      .filter((item) => {
        const key = item.id || `${item.type}:${item.createdAt}:${item.title}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    const groups = new Map();
    rows.forEach((item) => {
      const groupKey = deliverableProductGroupKey(item);
      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          id: `product-${hashString(groupKey)}`,
          key: groupKey,
          rows: [],
          formats: new Set(),
          relatedIds: [],
        });
      }
      const group = groups.get(groupKey);
      group.rows.push(item);
      group.formats.add(deliverableFormatCode(item.type));
      group.relatedIds.push(item.id);
    });
    return [...groups.values()].map((group) => {
      const rowsByPreference = [...group.rows].sort((a, b) => {
        const aType = deliverableFormatCode(a.type) === "selection" ? 0 : 1;
        const bType = deliverableFormatCode(b.type) === "selection" ? 0 : 1;
        const aSource = a.source === "cloud" ? 0 : a.source === "local" ? 1 : 2;
        const bSource = b.source === "cloud" ? 0 : b.source === "local" ? 1 : 2;
        return aType - bType || aSource - bSource;
      });
      const primary = rowsByPreference[0] || group.rows[0];
      const latest = [...group.rows].sort((a, b) => validDateFor(b.createdAt).getTime() - validDateFor(a.createdAt).getTime())[0] || primary;
      const batchSource = rowsByPreference.find((item) => item.batch)?.batch || primary?.batch || null;
      const formats = [...group.formats];
      const source = group.rows.some((item) => item.source === "cloud")
        ? "cloud"
        : group.rows.some((item) => item.source === "local")
          ? "local"
          : (primary?.source || "");
      const outputFormats = formats.filter((format) => format === "pdf" || format === "video");
      const outputStateFor = (format) => {
        const matching = group.rows.filter((row) => deliverableFormatCode(row.type) === format);
        if (matching.some((row) => row.status === "ready" && (row.viewUrl || row.downloadUrl))) return "ready";
        if (matching.some((row) => row.status === "needs-attention" || row.status === "failed")) return "needs-attention";
        return "pending";
      };
      const outputStates = outputFormats.map(outputStateFor);
      const status = outputStates.length && outputStates.every((value) => value === "ready")
        ? "ready"
        : outputStates.includes("needs-attention")
          ? "needs-attention"
          : "pending";
      const failureReason = status === "needs-attention"
        ? group.rows.map((row) => row.failureReason).find(Boolean) || ""
        : "";
      return {
        ...primary,
        id: group.id,
        type: "product",
        label: deliverableFormatsLabel(formats),
        title: String(rowsByPreference.find((item) => !needsGeneratedDeliverableName(item))?.title || primary?.title || "").trim(),
        createdAt: latest?.createdAt || primary?.createdAt || "",
        status,
        failureReason,
        bytes: group.rows.reduce((sum, item) => sum + (Number(item.bytes) || 0), 0),
        batch: batchSource,
        source,
        formats,
        relatedIds: group.relatedIds.filter(Boolean),
        records: group.rows,
      };
    }).filter((item) => item.formats.some((format) => format === "pdf" || format === "video"));
  };

  const cloneBatch = (batch) => {
    try {
      return JSON.parse(JSON.stringify(batch));
    } catch {
      return batch;
    }
  };

  const deliverableTypeCode = (type) => {
    const normalized = String(type || "").toLowerCase();
    if (normalized === "pdf") return "PDF";
    if (normalized === "selection" || normalized === "product") return "SELECTION";
    return "VIDEO";
  };

  const validDateFor = (value) => {
    const date = value ? new Date(value) : new Date();
    return Number.isNaN(date.getTime()) ? new Date() : date;
  };

  const dateCodeFor = (value) => {
    const date = validDateFor(value);
    return [
      String(date.getFullYear()).slice(-2),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("");
  };

  const deliverableProjectTitleFor = (item) => {
    const batch = item?.batch || item;
    const projectTitles = Array.isArray(batch?.projects)
      ? batch.projects.map((project) => String(project?.projectTitle || "").trim()).filter(Boolean)
      : [];
    if (projectTitles.length === 1) return projectTitles[0];
    if (projectTitles.length > 1) return "Multiple";
    const itemProjectTitle = Array.isArray(batch?.items)
      ? batch.items.map((row) => String(row?.projectTitle || "").trim()).find(Boolean)
      : "";
    return String(item?.projectTitle || batch?.projectTitle || itemProjectTitle || "").trim();
  };

  const deliverableProjectCodeFor = (item, fallback = "") => (
    String(deliverableProjectTitleFor(item) || fallback || "Selection")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^A-Za-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      || "Selection"
  );
  const escapeRegExp = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const generatedDeliverableStemFor = (item, fallback = "") => (
    `${deliverableProjectCodeFor(item, fallback)}-${dateCodeFor(item?.createdAt || item?.batch?.createdAt)}`
  );
  const generatedDeliverableSequencePatternFor = (stem) => (
    new RegExp(`^${escapeRegExp(stem)}(?:-(?:PDF|VIDEO|SELECTION))?-(\\d+)$`, "i")
  );

  const isLegacyAutoDeliverableTitle = (title) => {
    const value = String(title || "").trim();
    return /^(PDF|Video):\s*/i.test(value)
      || /^\d{6}-(PDF|VIDEO|SELECTION)-\d+$/i.test(value)
      || /^[A-Za-z0-9-]+-\d{6}-(PDF|VIDEO|SELECTION)-\d+$/i.test(value)
      || /^[A-Za-z0-9-]+-\d{6}-\d+$/i.test(value);
  };

  const needsGeneratedDeliverableName = (item) => {
    const title = String(item?.title || "").trim();
    return !title || isLegacyAutoDeliverableTitle(title);
  };

  const generatedDeliverableNamesFor = (items) => {
    const names = new Map();
    const groups = new Map();
    items.forEach((item) => {
      if (!item?.id || !needsGeneratedDeliverableName(item)) return;
      const key = generatedDeliverableStemFor(item);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
    groups.forEach((group, stem) => {
      const pattern = generatedDeliverableSequencePatternFor(stem);
      const used = new Set(items
        .filter((item) => !needsGeneratedDeliverableName(item))
        .map((item) => String(item.title || "").trim().match(pattern)?.[1])
        .filter(Boolean)
        .map(Number));
      let next = 1;
      [...group].sort((a, b) => (
        validDateFor(a.createdAt || a.batch?.createdAt).getTime() - validDateFor(b.createdAt || b.batch?.createdAt).getTime()
        || String(a.id).localeCompare(String(b.id))
      )).forEach((item) => {
        while (used.has(next)) next += 1;
        used.add(next);
        names.set(item.id, `${generatedDeliverableStemFor(item)}-${next}`);
      });
    });
    return names;
  };

  const displayDeliverableTitleFor = (item, generatedNames = new Map()) => (
    needsGeneratedDeliverableName(item)
      ? generatedNames.get(item.id) || `${generatedDeliverableStemFor(item)}-1`
      : String(item?.title || "").trim()
  );
  const deliverableMediaSummaryFor = (item) => {
    const batch = item?.batch || {};
    const explicit = batch.mediaSummary || item?.mediaSummary || {};
    const photos = Number(explicit.photos ?? explicit.photoCount);
    const videos = Number(explicit.videos ?? explicit.videoCount);
    if (Number.isFinite(photos) || Number.isFinite(videos)) {
      return {
        photos: Number.isFinite(photos) ? Math.max(0, photos) : 0,
        videos: Number.isFinite(videos) ? Math.max(0, videos) : 0,
      };
    }
    const rows = Array.isArray(batch.items) ? batch.items : [];
    return rows.reduce((summary, row) => {
      if (String(row?.mediaType || "").toLowerCase() === "video") summary.videos += 1;
      else summary.photos += 1;
      return summary;
    }, { photos: 0, videos: 0 });
  };
  const pluralizeMediaCount = (count, singular, plural = `${singular}s`) => (
    `${count} ${count === 1 ? singular : plural}`
  );
  const deliverableMediaSummaryLabelFor = (item) => {
    const summary = deliverableMediaSummaryFor(item);
    const parts = [];
    if (summary.photos) parts.push(t(summary.photos === 1 ? "re.shelf.photo" : "re.shelf.photos", { count: summary.photos }, pluralizeMediaCount(summary.photos, "photo")));
    if (summary.videos) parts.push(t(summary.videos === 1 ? "re.shelf.video" : "re.shelf.videos", { count: summary.videos }, pluralizeMediaCount(summary.videos, "video")));
    return parts.join(" + ");
  };

  const deliverableStatusTone = (status) => {
    const value = String(status || "").toLowerCase();
    if (value === "needs-attention" || value === "failed") return "needs-attention";
    if (value === "pending" || value === "queued" || value === "processing") return "pending";
    if (value === "local") return "local";
    return "ready";
  };

  const statusForDeliverableRecords = (records = []) => {
    const statuses = (Array.isArray(records) ? records : [])
      .map((record) => deliverableStatusTone(record?.status || "ready"));
    if (statuses.includes("needs-attention")) return "needs-attention";
    if (statuses.includes("pending")) return "pending";
    return "ready";
  };

  const deliverableSourceBadgeFor = (item) => {
    const records = Array.isArray(item?.records) ? item.records : [item].filter(Boolean);
    const hasCloud = records.some((record) => record?.source === "cloud");
    const hasLocal = records.some((record) => record?.source === "local");
    if (state.cloudDeliverablesError && hasLocal && !hasCloud) {
      return { label: t("re.shelf.cloud_save_issue", {}, "Cloud save issue"), tone: "needs-attention" };
    }
    if (hasCloud) return { label: t("re.shelf.cloud_saved", {}, "Cloud saved"), tone: "ready" };
    if (hasLocal) return { label: t("re.shelf.device_saved", {}, "Saved on this device"), tone: "local" };
    return { label: t("re.shelf.gallery_record", {}, "Gallery record"), tone: "local" };
  };

  const formatStatusBadgeFor = (format, records = []) => {
    const label = format === "pdf" ? "PDF" : format === "video"
      ? t("re.shelf.format_video", {}, "Video")
      : t("re.shelf.format_selection", {}, "Selection");
    const status = statusForDeliverableRecords(records);
    if (status === "needs-attention") return { label: t("re.shelf.attention", { format: label }, `${label} needs attention`), tone: "needs-attention" };
    if (status === "pending") return { label: t("re.shelf.pending", { format: label }, `${label} pending`), tone: "pending" };
    if (format === "selection") return { label: t("re.shelf.selection_saved", {}, "Selection saved"), tone: "ready" };
    const hasOutputUrl = records.some((record) => record?.viewUrl || record?.downloadUrl);
    return hasOutputUrl
      ? { label: `${label} ${t("re.status.ready", {}, "Ready").toLowerCase()}`, tone: "ready" }
      : { label: t("re.shelf.pending", { format: label }, `${label} pending`), tone: "pending" };
  };

  const deliverableStatusBadgesFor = (item) => {
    const records = Array.isArray(item?.records) ? item.records : [item].filter(Boolean);
    const badges = [deliverableSourceBadgeFor(item)];
    ["selection"].forEach((format) => {
      const matching = records.filter((record) => deliverableFormatCode(record?.type) === format);
      if (matching.length) badges.push(formatStatusBadgeFor(format, matching));
    });
    return badges;
  };

  const formatDownloadActionsHtmlFor = (item) => {
    const records = Array.isArray(item?.records) ? item.records : [item].filter(Boolean);
    return ["pdf", "video"].map((format) => {
      const matching = records.filter((record) => deliverableFormatCode(record?.type) === format);
      if (!matching.length) return "";
      const ready = matching.find((record) => (
        record.status === "ready" && (record.downloadUrl || record.viewUrl)
      ));
      const label = format === "pdf" ? "PDF" : t("re.shelf.format_video", {}, "Video");
      if (ready) {
        const url = ready.downloadUrl || ready.viewUrl;
        return `
          <button class="real-estate-deliverable-status is-action" type="button" data-re-status-tone="ready" data-re-download-output-url="${escapeHtml(url)}" data-re-download-output-format="${escapeHtml(format)}" data-re-download-output-filename="${escapeHtml(ready.filename || "")}">
            ${escapeHtml(t("re.shelf.download", { format: label }, `Download ${label}`))}
          </button>
        `;
      }
      const needsAttention = matching.some((record) => record.status === "needs-attention" || record.status === "failed");
      return `
        <button class="real-estate-deliverable-status" type="button" data-re-status-tone="${needsAttention ? "needs-attention" : "pending"}" disabled>
          ${escapeHtml(needsAttention
            ? t("re.shelf.attention", { format: label }, `${label} needs attention`)
            : t("re.shelf.pending", { format: label }, `${label} pending`))}
        </button>
      `;
    }).join("");
  };

  const statusBadgesHtml = (badges = []) => (
    badges.map((badge) => `
      <span class="real-estate-deliverable-status" data-re-status-tone="${escapeHtml(badge.tone)}">
        ${escapeHtml(badge.label)}
      </span>
    `).join("")
  );

  const nextGeneratedDeliverableName = (type, createdAt, excludeId = "", projectTitle = "") => {
    const existingItems = producedDeliverables().filter((item) => item.id !== excludeId);
    const generatedNames = generatedDeliverableNamesFor(existingItems);
    const stem = generatedDeliverableStemFor({ type, createdAt, projectTitle }, selectedPropertyTitle());
    const pattern = generatedDeliverableSequencePatternFor(stem);
    const used = new Set(existingItems
      .map((item) => displayDeliverableTitleFor(item, generatedNames).match(pattern)?.[1])
      .filter(Boolean)
      .map(Number));
    let next = 1;
    while (used.has(next)) next += 1;
    return `${stem}-${next}`;
  };

  const activeDeliverableName = () => {
    if (!state.activeDeliverableId) return state.activeDeliverableName || nextGeneratedDeliverableName("selection", new Date().toISOString(), "", selectedPropertyTitle());
    const items = producedDeliverables();
    const item = items.find((deliverable) => deliverable.id === state.activeDeliverableId);
    if (!item) return state.activeDeliverableName || t("re.selection.label", {}, "Selection");
    const generatedNames = generatedDeliverableNamesFor(items);
    return displayDeliverableTitleFor(item, generatedNames);
  };

  const syncActiveProductName = () => {
    if (elements.activeProductLabel) elements.activeProductLabel.hidden = !state.detailMode;
    if (elements.activeProductName && document.activeElement !== elements.activeProductName) {
      elements.activeProductName.value = activeDeliverableName();
    }
  };

  const syncCreateProductButtons = (products = producedDeliverables()) => {
    document.querySelectorAll("[data-re-create-product]").forEach((button) => {
      const shelfButton = button.matches("[data-re-shelf-create-product]");
      button.hidden = shelfButton ? products.length === 0 : state.detailMode || products.length > 0;
      button.textContent = products.length === 0
        ? t("re.cta.first_selection", {}, "Create your first selection")
        : t("re.cta.create_selection", {}, "+ Create new selection");
    });
  };

  const credentialsForCloudDeliverables = async ({ promptIfMissing = false } = {}) => {
    const credentials = cloudCredentialSnapshot();
    if (!credentials.username) return null;
    writeSessionCredentials(credentials.username);
    if (state.unlocked) writeSession(credentials.username);
    return credentials;
  };

  const fetchCloudDeliverables = async ({ promptIfMissing = false, quiet = true } = {}) => {
    const baseUrl = workerBaseUrl();
    if (!state.unlocked || !state.gallery?.key || !baseUrl) return [];
    const credentials = await credentialsForCloudDeliverables({ promptIfMissing });
    if (!credentials) {
      renderProducedDeliverables();
      if (!quiet && promptIfMissing) setStatus("Cloud products need the client password to sync.");
      return [];
    }
    state.cloudDeliverablesBusy = true;
    state.cloudDeliverablesError = "";
    renderProducedDeliverables();
    try {
      const response = await fetch(`${baseUrl}/real-estate/deliverables/list`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          galleryKey: state.gallery?.key || "",
          username: credentials.username,
          limit: 50,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error?.message || "Cloud products could not be loaded.");
      }
      state.cloudDeliverables = Array.isArray(body.deliverables) ? body.deliverables : [];
      state.cloudDeliverablesLoaded = true;
      if (!quiet) {
        setStatus(`Synced ${state.cloudDeliverables.length} saved product${state.cloudDeliverables.length === 1 ? "" : "s"} from the cloud`);
      }
      return state.cloudDeliverables;
    } catch (error) {
      if (handleAuthFailure(error)) return [];
      state.cloudDeliverablesError = error?.message || "Cloud products could not be loaded.";
      if (!quiet) setStatus(state.cloudDeliverablesError);
      throw error;
    } finally {
      state.cloudDeliverablesBusy = false;
      renderProducedDeliverables();
    }
  };

  const saveCloudDeliverable = async (record) => {
    const baseUrl = workerBaseUrl();
    if (!record?.id || !state.gallery?.key || !baseUrl || !state.unlocked) return null;
    const credentials = await credentialsForCloudDeliverables({ promptIfMissing: false });
    if (!credentials) return null;
    const response = await fetch(`${baseUrl}/real-estate/deliverables`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        galleryKey: state.gallery?.key || "",
        username: credentials.username,
        deliverable: record,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw realEstateWorkerError(response, body);
    }
    const saved = body.deliverable || record;
    const existing = Array.isArray(state.cloudDeliverables) ? state.cloudDeliverables : [];
    state.cloudDeliverables = [saved, ...existing.filter((item) => item?.id !== saved.id)].slice(0, 50);
    state.cloudDeliverablesLoaded = true;
    state.cloudDeliverablesError = "";
    renderProducedDeliverables();
    return saved;
  };

  const mergeCloudDeliverables = (records = []) => {
    const incoming = (Array.isArray(records) ? records : []).filter((item) => item?.id);
    if (!incoming.length) return;
    const existing = Array.isArray(state.cloudDeliverables) ? state.cloudDeliverables : [];
    const incomingIds = new Set(incoming.map((item) => String(item.id)));
    state.cloudDeliverables = [...incoming, ...existing.filter((item) => !incomingIds.has(String(item?.id || "")))].slice(0, 50);
    state.cloudDeliverablesLoaded = true;
    state.cloudDeliverablesError = "";
    renderProducedDeliverables();
  };

  const submitCloudAssemblyJob = async ({ batch, formats = ["pdf", "video"], title = "" } = {}) => {
    const baseUrl = workerBaseUrl();
    if (!batch?.batchId) throw new Error("Select media before creating cloud outputs.");
    if (!state.gallery?.key || !baseUrl || !state.unlocked) throw new Error("Cloud output assembly needs the Photos By Elie Worker.");
    const credentials = await credentialsForCloudDeliverables({ promptIfMissing: false });
    if (!credentials) throw new Error("Client login is needed to create cloud outputs.");
    const response = await fetch(`${baseUrl}/real-estate/deliverables/jobs`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        galleryKey: state.gallery?.key || "",
        username: credentials.username,
        title: title || activeDeliverableName(),
        formats,
        batch,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw realEstateWorkerError(response, body);
    mergeCloudDeliverables(body.deliverables || []);
    return body;
  };

  const fetchCloudAssemblyJobStatus = async (jobId) => {
    const baseUrl = workerBaseUrl();
    const cleanJobId = String(jobId || "").trim();
    if (!cleanJobId || !state.gallery?.key || !baseUrl || !state.unlocked) return null;
    const response = await fetch(`${baseUrl}/real-estate/deliverables/jobs/${encodeURIComponent(cleanJobId)}`, {
      method: "GET",
      credentials: "include",
      headers: { "accept": "application/json" },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw realEstateWorkerError(response, body);
    mergeCloudDeliverables(body.job?.deliverables || []);
    return body.job || null;
  };

  const waitForCloudAssemblyJob = async (jobId, { timeoutMs = 20 * 60 * 1000 } = {}) => {
    const startedAt = Date.now();
    let attempt = 0;
    while (Date.now() - startedAt < timeoutMs) {
      const job = await fetchCloudAssemblyJobStatus(jobId);
      const status = String(job?.status || "pending").toLowerCase().replace("_", "-");
      const elapsedSeconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
      const progress = job?.progress && typeof job.progress === "object" ? job.progress : {};
      const phase = String(progress.phase || (status === "pending" ? "queued" : "starting")).trim().toLowerCase();
      const percent = status === "ready"
        ? 100
        : Math.max(1, Math.min(99, Math.round(Number(progress.percent) || (status === "processing" ? 3 : 1))));
      const phaseLabel = t(`re.cloud.phase.${phase}`, {}, phase.replaceAll("-", " "));
      updateOutputProgress({
        title: status === "ready"
          ? t("re.cloud.ready_title", {}, "Cloud output ready")
          : t("re.cloud.generating_title", {}, "Generating in the cloud"),
        detail: status === "ready"
          ? t("re.cloud.ready_detail", {}, "The finished files are available on the shelf.")
          : t("re.cloud.progress_detail", {
            phase: phaseLabel,
            percent,
            elapsed: elapsedSeconds,
          }, `${phaseLabel} · ${percent}% · ${elapsedSeconds}s`),
        current: percent,
        total: 100,
        done: status === "ready",
      });
      if (status === "ready") return job;
      if (["failed", "needs-attention"].includes(status)) {
        throw new Error(job?.failureReason || "Cloud output needs attention.");
      }
      attempt += 1;
      await new Promise((resolve) => window.setTimeout(resolve, Math.min(5000, 1500 + (attempt * 250))));
    }
    throw new Error(t("re.cloud.timeout", {}, "Cloud rendering is still running. It will remain on the shelf and can be refreshed later."));
  };

  const pendingCloudOutputFor = (format, batch) => {
    const normalizedFormat = String(format || "").toLowerCase() === "mp4" ? "video" : String(format || "").toLowerCase();
    const fingerprint = batchProductFingerprint(batch);
    const activeProduct = producedDeliverables().find((item) => item.id === state.activeDeliverableId);
    const activeIds = new Set(Array.isArray(activeProduct?.relatedIds) ? activeProduct.relatedIds.map(String) : []);
    const candidates = (Array.isArray(state.cloudDeliverables) ? state.cloudDeliverables : [])
      .map(normalizeDeliverable)
      .filter((record) => deliverableFormatCode(record.type) === normalizedFormat)
      .filter((record) => ["pending", "queued", "processing"].includes(String(record.status || "").toLowerCase()))
      .filter((record) => batchProductFingerprint(record.batch) === fingerprint)
      .sort((left, right) => (
        Number(activeIds.has(String(right.id))) - Number(activeIds.has(String(left.id)))
        || validDateFor(right.createdAt).getTime() - validDateFor(left.createdAt).getTime()
      ));
    return candidates[0] || null;
  };

  const completeCloudOutput = async ({ record, blob, filename }) => {
    const baseUrl = workerBaseUrl();
    if (!record?.id || !blob?.size || !baseUrl) throw new Error("The prepared cloud output is empty.");
    const maxBytes = 95 * 1024 * 1024;
    if (blob.size > maxBytes) throw new Error("The prepared output exceeds the 95 MB cloud-upload limit.");
    const url = new URL(`${baseUrl}/real-estate/deliverables/${encodeURIComponent(record.id)}/complete`);
    url.searchParams.set("galleryKey", state.gallery?.key || "");
    url.searchParams.set("filename", filename || record.filename || "output.bin");
    const response = await fetch(url.href, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": blob.type || (record.type === "pdf" ? "application/pdf" : "video/webm") },
      body: blob,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw realEstateWorkerError(response, body);
    const saved = body.deliverable;
    if (saved) mergeCloudDeliverables([saved]);
    return saved || record;
  };

  const failCloudOutput = async (record, error) => {
    const baseUrl = workerBaseUrl();
    if (!record?.id || !baseUrl) return null;
    try {
      const response = await fetch(`${baseUrl}/real-estate/deliverables/${encodeURIComponent(record.id)}/fail`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          galleryKey: state.gallery?.key || "",
          failureReason: error?.message || String(error || "Browser output preparation failed."),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw realEstateWorkerError(response, body);
      if (body.deliverable) mergeCloudDeliverables([body.deliverable]);
      return body.deliverable || null;
    } catch (statusError) {
      console.warn("Could not mark cloud output as needing attention", statusError);
      return null;
    }
  };

  const queueCloudOutputs = async ({ batch, formats = ["pdf", "video"], progressKind = "cloud-output" } = {}) => {
    startOutputProgress({
      title: t("re.cloud.preparing_title", {}, "Preparing cloud output"),
      detail: t("re.cloud.finding_entry", {}, "Finding or creating the finished-product shelf entry..."),
      total: 100,
      kind: progressKind,
    });
    try {
      const requestedFormats = [...new Set(formats.map((format) => String(format || "").toLowerCase()))]
        .filter((format) => format === "pdf" || format === "video");
      const reused = requestedFormats.map((format) => pendingCloudOutputFor(format, batch)).filter(Boolean);
      const reusedFormats = new Set(reused.map((record) => deliverableFormatCode(record.type)));
      const missingFormats = requestedFormats.filter((format) => !reusedFormats.has(format));
      updateOutputProgress({
        title: t("re.cloud.preparing_title", {}, "Preparing cloud output"),
        detail: missingFormats.length
          ? t("re.cloud.creating_entry", {}, "Creating the shelf entry...")
          : t("re.cloud.reusing_entry", {}, "Reusing the pending shelf entry..."),
        current: 1,
        total: 100,
      });
      const result = missingFormats.length ? await submitCloudAssemblyJob({
        batch,
        formats: missingFormats,
        title: activeDeliverableName(),
      }) : null;
      const submitted = Array.isArray(result?.deliverables) ? result.deliverables.map(normalizeDeliverable) : [];
      const records = requestedFormats.map((format) => (
        reused.find((record) => deliverableFormatCode(record.type) === format)
        || submitted.find((record) => deliverableFormatCode(record.type) === format)
      )).filter(Boolean);
      const recordIds = new Set(records.map((record) => String(record.id)));
      const product = producedDeliverables().find((item) => (
        Array.isArray(item.relatedIds) && item.relatedIds.some((id) => recordIds.has(String(id)))
      ));
      if (product) {
        state.activeDeliverableId = product.id;
        state.activeDeliverableName = product.title;
        syncActiveProductName();
      }
      const formatLabel = requestedFormats.map((format) => format === "pdf"
        ? t("re.cloud.format.pdf", {}, "PDF")
        : t("re.cloud.format.video", {}, "video")).join(" + ");
      const jobId = result?.job?.id || records.map((record) => record?.assemblyJob?.id).find(Boolean) || "";
      if (!jobId) throw new Error("Cloud assembly job id is missing.");
      updateOutputProgress({
        title: t("re.cloud.generating_title", {}, "Generating in the cloud"),
        detail: t("re.cloud.progress_detail", {
          phase: t("re.cloud.phase.queued", {}, "Waiting for cloud renderer"),
          percent: 1,
          elapsed: 0,
        }, "Waiting for cloud renderer · 1% · 0s"),
        current: 1,
        total: 100,
      });
      const completedJob = await waitForCloudAssemblyJob(jobId);
      completeOutputProgress(t("re.cloud.ready_shelf", { formats: formatLabel }, `${formatLabel} ready on the finished-products shelf.`));
      return { ...(result || {}), job: completedJob, deliverables: completedJob?.deliverables || records, reused: reused.length };
    } catch (error) {
      const message = error?.message || t("re.cloud.failed", {}, "Cloud output could not be prepared.");
      setStatus(message);
      failOutputProgress(message);
      throw error;
    }
  };

  const recentDeliverableDownloads = new Map();
  const deliverableDownloadCooldownMs = 2500;

  const openDeliverableUrl = async (url, mode = "view") => {
    const rawUrl = String(url || "").trim();
    const baseUrl = String(workerBaseUrl() || "").replace(/\/+$/, "");
    let href = rawUrl;
    if (rawUrl && baseUrl) {
      try {
        href = new URL(rawUrl, `${baseUrl}/`).href;
      } catch (_error) {
        href = rawUrl;
      }
    }
    if (!href) throw new Error("This cloud output is not ready yet.");
    if (mode === "view") {
      window.open(href, "_blank", "noopener");
      return;
    }
    const startedAt = Date.now();
    const previousStart = recentDeliverableDownloads.get(href) || 0;
    if (startedAt - previousStart < deliverableDownloadCooldownMs) return;
    recentDeliverableDownloads.set(href, startedAt);
    window.setTimeout(() => {
      if (recentDeliverableDownloads.get(href) === startedAt) recentDeliverableDownloads.delete(href);
    }, deliverableDownloadCooldownMs);

    let sameOrigin = false;
    try {
      sameOrigin = new URL(href, window.location.href).origin === window.location.origin;
    } catch (_error) {
      sameOrigin = false;
    }
    const link = document.createElement("a");
    link.href = href;
    if (sameOrigin) link.download = "";
    document.body.append(link);
    link.click();
    link.remove();
  };

  const relatedDeliverableIdsFor = (deliverableId) => {
    const item = producedDeliverables().find((deliverable) => deliverable.id === deliverableId);
    return new Set([deliverableId, ...(Array.isArray(item?.relatedIds) ? item.relatedIds : [])].filter(Boolean).map(String));
  };

  const removeLocalDeliverable = (deliverableId) => {
    const ids = relatedDeliverableIdsFor(deliverableId);
    const before = Array.isArray(state.localDeliverables) ? state.localDeliverables : [];
    state.localDeliverables = before.filter((item) => !ids.has(String(item?.id || "")));
    writeJson(localDeliverablesStoreKey(), state.localDeliverables);
  };

  const removeCloudDeliverableState = (deliverableId) => {
    const ids = relatedDeliverableIdsFor(deliverableId);
    const before = Array.isArray(state.cloudDeliverables) ? state.cloudDeliverables : [];
    state.cloudDeliverables = before.filter((item) => !ids.has(String(item?.id || "")));
  };

  const deleteCloudDeliverable = async (deliverableId, { promptIfMissing = false } = {}) => {
    const baseUrl = workerBaseUrl();
    if (!state.gallery?.key || !baseUrl || !state.unlocked) {
      if (promptIfMissing) throw new Error("Cloud products are unavailable.");
      return null;
    }
    const credentials = await credentialsForCloudDeliverables({ promptIfMissing });
    if (!credentials) {
      if (promptIfMissing) throw new Error("Client login is needed to delete this cloud product.");
      return null;
    }
    const response = await fetch(`${baseUrl}/real-estate/deliverables/delete`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        galleryKey: state.gallery?.key || "",
        username: credentials.username,
        id: deliverableId,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw realEstateWorkerError(response, body);
    }
    return body;
  };

  const deleteProducedDeliverable = async (deliverableId) => {
    if (!requireUnlocked()) return;
    const items = producedDeliverables();
    const generatedNames = generatedDeliverableNamesFor(items);
    const item = items.find((deliverable) => deliverable.id === deliverableId);
    if (!item || !["cloud", "local"].includes(item.source)) return;
    const title = displayDeliverableTitleFor(item, generatedNames);
    const confirmed = window.confirm(`Delete ${title || "this product"} from saved products?`);
    if (!confirmed) return;

    setStatus(`Deleting ${title || "product"}...`);
    const cloudRecordIds = (Array.isArray(item.records) ? item.records : [item])
      .filter((record) => record?.source === "cloud")
      .map((record) => String(record.id || ""))
      .filter(Boolean);
    if (cloudRecordIds.length) {
      for (const cloudId of cloudRecordIds) {
        await deleteCloudDeliverable(cloudId, { promptIfMissing: true });
      }
    } else {
      (Array.isArray(item.relatedIds) ? item.relatedIds : [deliverableId]).forEach((relatedId) => {
        deleteCloudDeliverable(relatedId, { promptIfMissing: false }).catch((error) => {
          state.cloudDeliverablesError = error?.message || "Cloud product could not be deleted.";
          renderProducedDeliverables();
        });
      });
    }
    removeLocalDeliverable(deliverableId);
    removeCloudDeliverableState(deliverableId);
    renderProducedDeliverables();
    setStatus(`Deleted ${title || "product"} from saved products.`);
  };

  const productIdForRecord = (record) => {
    const item = producedDeliverables().find((deliverable) => (
      Array.isArray(deliverable.relatedIds) && deliverable.relatedIds.includes(record?.id)
    ));
    return item?.id || record?.id || "";
  };

  const saveLocalDeliverable = ({ type = "file", batch = null, filename = "", bytes = 0 } = {}) => {
    if (!batch?.batchId) return null;
    const normalizedType = String(type || "file").toLowerCase();
    const id = `local-${normalizedType}-${batch.batchId}`;
    const existing = Array.isArray(state.localDeliverables) ? state.localDeliverables : [];
    const existingRecord = existing.find((item) => item?.id === id);
    const createdAt = batch.createdAt || new Date().toISOString();
    const projectTitle = deliverableProjectTitleFor({ batch }) || selectedPropertyTitle();
    const record = {
      id,
      type: normalizedType,
      title: String(existingRecord?.title || "").trim()
        || (normalizedType === "selection" ? String(state.activeDeliverableName || "").trim() : "")
        || nextGeneratedDeliverableName(normalizedType, createdAt, id, projectTitle),
      createdAt,
      status: "ready",
      bytes: Number(bytes) || 0,
      filename: String(filename || ""),
      batch: cloneBatch(batch),
    };
    state.localDeliverables = [record, ...existing.filter((item) => item?.id !== record.id)].slice(0, 25);
    const productId = productIdForRecord(record);
    if (normalizedType === "selection" && !state.activeDeliverableId) {
      state.activeDeliverableId = productId || record.id;
      state.activeDeliverableName = record.title;
    }
    writeJson(localDeliverablesStoreKey(), state.localDeliverables);
    renderProducedDeliverables();
    syncActiveProductName();
    saveCloudDeliverable(record).catch((error) => {
      state.cloudDeliverablesError = error?.message || "Cloud product could not be saved.";
      renderProducedDeliverables();
    });
    return record;
  };

  const saveSelectionBeforeOutput = (batch) => {
    if (!batch?.batchId) return null;
    const filename = `${state.gallery?.key || "real-estate"}-${batch.batchId}-selection.html`;
    return saveLocalDeliverable({ type: "selection", batch, filename });
  };

  const renameProducedDeliverable = async (deliverableId, name) => {
    if (!requireUnlocked()) return;
    const items = producedDeliverables();
    const generatedNames = generatedDeliverableNamesFor(items);
    const item = items.find((deliverable) => deliverable.id === deliverableId);
    if (!item || !["cloud", "local"].includes(item.source)) return;
    const fallback = displayDeliverableTitleFor(item, generatedNames);
    const title = String(name || "").trim() || fallback;
    const ids = relatedDeliverableIdsFor(deliverableId);
    const updateRecord = (record) => (
      ids.has(String(record?.id || ""))
        ? { ...record, title }
        : record
    );
    state.localDeliverables = (Array.isArray(state.localDeliverables) ? state.localDeliverables : []).map(updateRecord);
    state.cloudDeliverables = (Array.isArray(state.cloudDeliverables) ? state.cloudDeliverables : []).map(updateRecord);
    writeJson(localDeliverablesStoreKey(), state.localDeliverables);
    if (state.activeDeliverableId === deliverableId || ids.has(state.activeDeliverableId)) {
      state.activeDeliverableId = deliverableId;
      state.activeDeliverableName = title;
      state.activeDeliverableNameEdited = true;
    }
    state.editingDeliverableNameId = "";
    renderProducedDeliverables();
    syncActiveProductName();
    setStatus(`Renamed product to ${title}.`);
    const updated = [...state.cloudDeliverables, ...state.localDeliverables]
      .filter((record) => ids.has(String(record?.id || "")));
    updated.forEach((record) => {
      saveCloudDeliverable(record).catch((error) => {
        state.cloudDeliverablesError = error?.message || "Cloud product name could not be saved.";
        renderProducedDeliverables();
      });
    });
  };

  const beginDeliverableNameEdit = (deliverableId) => {
    state.editingDeliverableNameId = String(deliverableId || "");
    renderProducedDeliverables();
    window.setTimeout(() => {
      const input = elements.deliverablesList?.querySelector(`[data-re-rename-deliverable="${attributeSelectorValue(deliverableId)}"]`);
      input?.focus();
      input?.select?.();
    }, 0);
  };

  const renameActiveProduct = async (name) => {
    const title = String(name || "").trim() || activeDeliverableName();
    state.activeDeliverableName = title;
    state.activeDeliverableNameEdited = true;
    if (state.activeDeliverableId) {
      await renameProducedDeliverable(state.activeDeliverableId, title);
    } else {
      syncActiveProductName();
    }
  };

  const renderProducedDeliverables = () => {
    if (!elements.deliverablesPanel || !elements.deliverablesList) return;
    const items = producedDeliverables();
    if (elements.selectedTotal) {
      elements.selectedTotal.textContent = state.cloudDeliverablesBusy && !state.cloudDeliverablesLoaded
        ? "…"
        : String(items.length);
    }
    elements.deliverablesPanel.hidden = items.length === 0;
    syncCreateProductButtons(items);
    if (!items.length) {
      elements.deliverablesList.innerHTML = "";
      syncFileActionLabels();
      return;
    }
    const generatedNames = generatedDeliverableNamesFor(items);
    const rowsHtml = items.map((item) => {
      const date = item.createdAt ? new Date(item.createdAt) : null;
      const dateLabel = date && !Number.isNaN(date.getTime()) ? date.toLocaleString(document.documentElement.lang || undefined) : item.createdAt;
      const displayTitle = displayDeliverableTitleFor(item, generatedNames);
      const canRename = ["cloud", "local"].includes(item.source);
      const mediaSummaryLabel = deliverableMediaSummaryLabelFor(item);
      const meta = [
        deliverableFormatsLabel(item.formats),
        mediaSummaryLabel,
        dateLabel,
        item.bytes ? formatBytes(item.bytes) : "",
      ].filter(Boolean).join(" / ");
      const canOpen = Boolean(item.editUrl || item.batch);
      const editingName = state.editingDeliverableNameId === item.id;
      const thumbnail = deliverableThumbnailFor(item);
      const statusBadges = statusBadgesHtml(deliverableStatusBadgesFor(item));
      return `
        <article class="real-estate-deliverable ${canOpen ? "is-openable" : ""} ${editingName ? "is-renaming" : ""}" data-re-status="${escapeHtml(item.status)}" ${canOpen ? `data-re-open-deliverable="${escapeHtml(item.id)}" role="button" tabindex="0"` : ""}>
          <button class="real-estate-deliverable-disclosure" type="button" ${canOpen ? `data-re-open-deliverable-button="${escapeHtml(item.id)}"` : "disabled"} aria-label="${escapeHtml(t("re.shelf.open", { title: displayTitle }, `Open ${displayTitle}`))}">
            <span aria-hidden="true"></span>
          </button>
          ${thumbnail ? `<img class="real-estate-deliverable-thumb" src="${escapeHtml(thumbnail)}" alt=""/>` : `<span class="real-estate-deliverable-thumb is-empty" aria-hidden="true"></span>`}
          <div class="real-estate-deliverable-copy">
            ${canRename && editingName
              ? `<input class="real-estate-deliverable-name" type="text" value="${escapeHtml(displayTitle)}" data-re-rename-deliverable="${escapeHtml(item.id)}" aria-label="${escapeHtml(t("re.shelf.product_name", {}, "Product name"))}"/>`
              : `<strong class="real-estate-deliverable-title">${escapeHtml(displayTitle)}</strong>`}
            <span>${escapeHtml(meta || item.label)}</span>
            <div class="real-estate-deliverable-statuses" aria-label="${escapeHtml(t("re.shelf.status_label", {}, "Product save status"))}">
              ${statusBadges}
              ${formatDownloadActionsHtmlFor(item)}
            </div>
            ${item.failureReason ? `<em class="real-estate-deliverable-reason">${escapeHtml(item.failureReason)}</em>` : ""}
          </div>
          ${canRename ? `
            <div class="real-estate-deliverable-tools">
              <button class="real-estate-deliverable-rename" type="button" data-re-edit-name="${escapeHtml(item.id)}" aria-label="${escapeHtml(t("re.shelf.rename", { title: displayTitle }, `Rename ${displayTitle}`))}">${reIcon("edit")}</button>
              <button class="real-estate-deliverable-delete" type="button" data-re-delete-deliverable="${escapeHtml(item.id)}" aria-label="${escapeHtml(t("re.shelf.delete", { title: displayTitle }, `Delete ${displayTitle}`))}">${reIcon("trash")}</button>
            </div>
          ` : ""}
        </article>
      `;
    }).join("");
    elements.deliverablesList.innerHTML = rowsHtml;
    syncFileActionLabels();
  };

  const albumSelectedCount = (slug) => selectedPhotos()
    .filter((photo) => selectedProjectIdsFor(photo).includes(slug))
    .length;

  const albumThumbnailFor = (slug) => {
    const photo = state.photos.find((candidate) => candidate.albumSlug === slug);
    return photo ? imageFor(photo) : "";
  };

  const deliverableThumbnailFor = (item) => {
    const batch = item?.batch;
    const photoId = Array.isArray(batch?.projects)
      ? batch.projects.flatMap((project) => project.items || []).find((row) => row?.photoId)?.photoId
      : Array.isArray(batch?.items)
        ? batch.items.find((row) => row?.photoId)?.photoId
        : "";
    const photo = state.photosById.get(photoId);
    return photo ? imageFor(photo) : "";
  };

  const renderAlbums = () => {
    if (!elements.albums) return;
    const selectedShoots = selectedShootSet();
    elements.albums.innerHTML = state.albums.length ? state.albums.map((album) => `
        <label class="real-estate-album-filter ${selectedShoots.has(album.slug) ? "is-active" : ""}" data-shoot-option="${escapeHtml(album.slug)}">
          <input type="checkbox" data-shoot-filter="${escapeHtml(album.slug)}" ${selectedShoots.has(album.slug) ? "checked" : ""}/>
          <img src="${escapeHtml(albumThumbnailFor(album.slug))}" alt=""/>
          <span>${escapeHtml(album.displayTitle || album.title)}</span>
          <small>${Number(album.photoCount) || 0} shoot media / ${albumSelectedCount(album.slug)} selected</small>
          <b>${selectedShoots.has(album.slug) ? "Included" : "Include shoot"}</b>
        </label>
      `).join("") : `<p class="real-estate-muted">No shoots are available yet.</p>`;
  };

  const renderGrid = () => {
    if (!elements.grid) return;
    const photos = filteredPhotos();
    elements.grid.dataset.density = state.density;
    elements.grid.innerHTML = photos.length ? photos.map((photo) => {
      const selected = isSelectedForActiveProject(photo);
      const assignedProjects = new Set(assignedProjectIdsFor(photo));
      const video = isVideo(photo);
      const mediaLabel = mediaLabelFor(photo);
      const duration = formatDuration(durationSecondsFor(photo));
      const originalProperty = selectedShootSet().has(photo.albumSlug) ? "" : albumTitleFor(photo);
      return `
        <article class="real-estate-photo-card ${selected ? "is-selected" : ""} ${video ? "is-video" : ""}" data-photo-id="${escapeHtml(photo.id)}">
          <div class="real-estate-photo-media-shell">
            <button class="real-estate-photo-media" type="button" data-open-photo="${escapeHtml(photo.id)}" aria-label="Open ${escapeHtml(titleFor(photo))}">
              <img loading="${state.wizardStep >= 2 ? "eager" : "lazy"}" decoding="async" src="${escapeHtml(imageFor(photo))}" alt="${escapeHtml(titleFor(photo))}"/>
              <span>${escapeHtml(originalProperty ? `${originalProperty} / shared` : albumTitleFor(photo))}</span>
              ${video ? `<b class="real-estate-media-type-badge">${escapeHtml(duration ? `${mediaLabel} ${duration}` : mediaLabel)}</b>` : ""}
            </button>
            <label class="real-estate-check real-estate-photo-select" title="Selected">
              <input type="checkbox" data-select-photo="${escapeHtml(photo.id)}" aria-label="Select ${escapeHtml(titleFor(photo))}" ${selected ? "checked" : ""}/>
            </label>
            <button class="real-estate-title-remove" type="button" data-remove-title-photo="${escapeHtml(photo.id)}" aria-label="Remove ${escapeHtml(titleFor(photo))} from ${escapeHtml(selectedPropertyTitle())}">&times;</button>
          </div>
          <div class="real-estate-photo-card-body">
            <label class="real-estate-title-field">
              <input type="text" data-title-photo="${escapeHtml(photo.id)}" aria-label="Output title for ${escapeHtml(titleFor(photo))}" value="${escapeHtml(titleFor(photo))}"/>
            </label>
            <div class="real-estate-project-picker" aria-label="Projects for ${escapeHtml(titleFor(photo))}">
              ${projectOptions().map((project) => `
                <label class="real-estate-project-choice">
                  <input type="checkbox" data-project-photo="${escapeHtml(photo.id)}" data-project-id="${escapeHtml(project.projectId)}" ${assignedProjects.has(project.projectId) ? "checked" : ""}/>
                  <span>${escapeHtml(project.projectTitle)}</span>
                </label>
              `).join("")}
            </div>
          </div>
        </article>
      `;
    }).join("") : `
      <div class="real-estate-empty-state">
        <strong>No media match this view.</strong>
        <span>Clear filters or choose another album.</span>
      </div>
    `;
    setStatus(`${photos.length} visible / ${state.photos.length} media`);
  };

  const renderDraft = () => {
    const selectedPhotos = activeSelectedPhotos();
    if (elements.actionBarSelected) elements.actionBarSelected.textContent = String(selectedPhotos.length);
    if (elements.draftCount) elements.draftCount.textContent = String(selectedPhotos.length);
    if (!elements.draftList) return;
    elements.draftList.innerHTML = selectedPhotos.length ? selectedPhotos.map((photo, index) => `
      <article class="real-estate-draft-item ${isVideo(photo) ? "is-video" : ""}" data-draft-photo="${escapeHtml(photo.id)}" aria-label="Drag ${escapeHtml(titleFor(photo))} to reorder selection">
        <span class="real-estate-draft-handle" data-draft-drag-handle aria-hidden="true" title="Drag to reorder">
          <span aria-hidden="true"></span>
        </span>
        <strong class="real-estate-draft-position">${index + 1}</strong>
        <img loading="eager" decoding="async" src="${escapeHtml(imageFor(photo))}" alt="" draggable="false"/>
        <div>
          <strong>${escapeHtml(titleFor(photo))}</strong>
          <small>${escapeHtml([mediaLabelFor(photo), selectedProjectIdsFor(photo).map((projectId) => projectOptionFor(projectId, photo).projectTitle).join(" + ")].filter(Boolean).join(" / "))}</small>
        </div>
        <div class="real-estate-draft-actions">
          <button type="button" data-move-draft="${escapeHtml(photo.id)}" data-direction="-1" aria-label="Move ${escapeHtml(titleFor(photo))} up">&uarr;</button>
          <button type="button" data-move-draft="${escapeHtml(photo.id)}" data-direction="1" aria-label="Move ${escapeHtml(titleFor(photo))} down">&darr;</button>
          <button type="button" data-remove-draft="${escapeHtml(photo.id)}" aria-label="Remove ${escapeHtml(titleFor(photo))}">&times;</button>
        </div>
      </article>
    `).join("") : `<p class="real-estate-muted">${escapeHtml(t("re.draft.empty", {}, "No selected media yet."))}</p>`;
  };

  const activeOutputSummary = () => state.albums
    .map((album) => ({ title: album.displayTitle || album.title, count: albumSelectedCount(album.slug) }))
    .filter((item) => item.count > 0)
    .map((item) => `${item.title}: ${item.count}`)
    .join(" / ");

  const stepCopy = () => {
    const selected = activeSelectedPhotos().length;
    if (state.wizardStep === 0) return t("re.status.choose_shoots_step", {}, "Choose the shoots you want to pick from.");
    if (state.wizardStep === 1) return t("re.status.click_media", { project: selectedPropertyTitle() }, `Click media from ${selectedPropertyTitle()} to select it. Shift-click selects a range.`);
    if (state.wizardStep === 2) return selected
      ? t("re.status.selected_titles", { count: selected }, `Only the ${selected} selected media items are shown. Change titles only where needed.`)
      : t("re.status.select_before_titles", {}, "Select at least one photo or video before editing titles.");
    if (state.wizardStep === 3) return selected
      ? t("re.status.drag_selected", { count: selected }, `Drag the ${selected} selected media items into the order you want.`)
      : t("re.status.select_before_order", {}, "Select at least one photo or video before ordering.");
    return selected
      ? t("re.status.ready_output", { summary: activeOutputSummary() || `${selected} selected media` }, `Ready for output: ${activeOutputSummary() || `${selected} selected media`}. Queue the PDF and video you want, then choose Next to follow them on the finished-products shelf.`)
      : t("re.status.select_before_output", {}, "Select at least one photo or video before creating outputs.");
  };

  const renderWizard = () => {
    const selected = activeSelectedPhotos().length;
    const shootCount = selectedShootIds().length;
    const firstStep = firstWizardStep();
    app.dataset.reStep = String(state.wizardStep);
    document.body.dataset.realEstateStep = String(state.wizardStep);
    if (elements.wizardStatus) elements.wizardStatus.textContent = stepCopy();
    document.querySelectorAll("[data-re-step-jump]").forEach((button) => {
      const parsed = Number(button.dataset.reStepJump);
      const step = Number.isFinite(parsed) ? parsed : firstStep;
      button.hidden = false;
      button.classList.toggle("is-active", step === state.wizardStep);
      button.setAttribute("aria-current", step === state.wizardStep ? "step" : "false");
      button.disabled = (step === 1 && shootCount === 0) || (step >= 2 && selected === 0);
    });
    document.querySelectorAll("[data-re-step-back]").forEach((button) => {
      button.disabled = state.wizardStep <= firstStep;
      button.hidden = state.wizardStep <= firstStep;
    });
    document.querySelectorAll("[data-re-step-next]").forEach((button) => {
      button.hidden = state.wizardStep >= 4;
      button.disabled = (state.wizardStep === 0 && shootCount === 0) || (state.wizardStep >= 1 && state.wizardStep < 4 && selected === 0);
      button.textContent = state.wizardStep === 0
        ? t("re.action.pick_photos", {}, "Pick photos")
        : (state.wizardStep === 3 ? t("re.action.choose_output", {}, "Choose output") : t("common.next", {}, "Next"));
    });
    document.querySelectorAll("[data-re-open-outputs], [data-re-download-outputs]").forEach((button) => {
      button.hidden = state.wizardStep !== 4;
      button.disabled = selected === 0;
    });
    document.querySelectorAll("[data-re-download-pdf], [data-re-download-slideshow]").forEach((button) => {
      button.hidden = state.wizardStep !== 4;
    });
    document.querySelectorAll("[data-re-clear-selection]").forEach((button) => {
      button.hidden = state.wizardStep === 0 || selected === 0;
    });
  };

  const syncPdfFormatControls = () => {
    state.pdfFormat = paperFormatFor(state.pdfFormat).key;
    document.querySelectorAll("[data-re-pdf-format]").forEach((input) => {
      input.checked = input.value === state.pdfFormat;
    });
  };

  const setPdfFormat = (value) => {
    state.pdfFormat = paperFormatFor(value).key;
    localStorage.setItem(pdfFormatKey, state.pdfFormat);
    syncPdfFormatControls();
    syncFileActionLabels();
  };

  const syncPdfOrientationControls = () => {
    state.pdfOrientation = normalizePdfOrientation(state.pdfOrientation);
    document.querySelectorAll("[data-re-pdf-orientation]").forEach((input) => {
      input.checked = input.value === state.pdfOrientation;
    });
  };

  const setPdfOrientation = (value) => {
    state.pdfOrientation = normalizePdfOrientation(value);
    localStorage.setItem(pdfOrientationKey, state.pdfOrientation);
    syncPdfOrientationControls();
    syncFileActionLabels();
  };

  const syncSlideshowPhotoSecondsControls = () => {
    state.slideshowPhotoSeconds = [3, 4, 5].includes(Number(state.slideshowPhotoSeconds))
      ? Number(state.slideshowPhotoSeconds)
      : 4;
    document.querySelectorAll("[data-re-slideshow-photo-seconds]").forEach((input) => {
      input.checked = Number(input.value) === state.slideshowPhotoSeconds;
    });
  };

  const setSlideshowPhotoSeconds = (value) => {
    const next = [3, 4, 5].includes(Number(value)) ? Number(value) : 4;
    const changed = state.slideshowPhotoSeconds !== next;
    state.slideshowPhotoSeconds = next;
    localStorage.setItem(slideshowPhotoSecondsKey, String(next));
    syncSlideshowPhotoSecondsControls();
    syncFileActionLabels();
    if (changed) invalidateVideoExportCache();
  };

  const syncSlideshowOrientationControls = () => {
    const normalized = normalizeSlideshowOrientation(state.slideshowOrientation);
    state.slideshowOrientation = normalized;
    document.querySelectorAll("[data-re-slideshow-orientation]").forEach((input) => {
      input.checked = input.dataset.reSlideshowOrientation === normalized;
    });
  };

  const setSlideshowOrientation = (value) => {
    const normalized = normalizeSlideshowOrientation(value);
    const changed = state.slideshowOrientation !== normalized;
    state.slideshowOrientation = normalized;
    localStorage.setItem(slideshowOrientationKey, normalized);
    syncSlideshowOrientationControls();
    syncFileActionLabels();
    if (changed) invalidateVideoExportCache();
  };

  const syncSlideshowMusicCountryControls = () => {
    const normalized = normalizeSlideshowMusicCountry(state.slideshowMusicCountry);
    state.slideshowMusicCountry = normalized;
    if (!elements.slideshowMusicCountry) return;
    elements.slideshowMusicCountry.value = normalized;
    const inferred = inferSlideshowMusicCountry();
    const trackCount = state.slideshowMusicTracks.filter((track) => track.country === inferred).length;
    const suffix = state.slideshowMusicManifestLoaded
      ? `${inferred}${trackCount ? `, ${trackCount} tracks` : ""}`
      : "loading";
    elements.slideshowMusicCountry.title = normalized === "auto"
      ? `Auto currently resolves to ${suffix}`
      : `Use ${normalized} music for generated videos`;
  };

  const setSlideshowMusicCountry = (value) => {
    const normalized = normalizeSlideshowMusicCountry(value);
    const changed = state.slideshowMusicCountry !== normalized;
    state.slideshowMusicCountry = normalized;
    localStorage.setItem(slideshowMusicCountryKey, normalized);
    syncSlideshowMusicCountryControls();
    if (changed) invalidateVideoExportCache();
  };

  const syncWatermarkControls = () => {
    if (elements.watermarkEnabled) elements.watermarkEnabled.checked = Boolean(state.watermarkEnabled);
    if (elements.watermarkText) {
      elements.watermarkText.value = String(state.watermarkText || "").trim() || pdfWatermarkText;
      elements.watermarkText.disabled = !state.watermarkEnabled;
    }
  };

  const setWatermarkEnabled = (enabled) => {
    const changed = state.watermarkEnabled !== Boolean(enabled);
    state.watermarkEnabled = Boolean(enabled);
    localStorage.setItem(watermarkKey, state.watermarkEnabled ? "on" : "off");
    syncWatermarkControls();
    if (changed) invalidateVideoExportCache();
  };

  const setWatermarkText = (value) => {
    const next = String(value || "");
    const changed = state.watermarkText !== next;
    state.watermarkText = next;
    localStorage.setItem(watermarkTextKey, state.watermarkText);
    syncWatermarkControls();
    if (changed) invalidateVideoExportCache();
  };

  const render = () => {
    state.density = "balanced";
    document.body.dataset.realEstateDensity = state.density;
    if (elements.mediaType) elements.mediaType.value = state.mediaType;
    syncAuthUi();
    syncActiveProductName();
    syncCreateProductButtons();
    renderAlbums();
    renderGrid();
    renderDraft();
    renderWizard();
    syncPdfFormatControls();
    syncPdfOrientationControls();
    syncSlideshowPhotoSecondsControls();
    syncSlideshowOrientationControls();
    syncSlideshowMusicCountryControls();
    syncWatermarkControls();
    syncFileActionLabels();
    window.photosByElieVersionInternalLinks?.(app);
  };

  const attributeSelectorValue = (value) => String(value || "").replace(/\\/g, "\\\\").replace(/"/g, "\\\"");

  const syncVisibleSelectionState = (photoIds = []) => {
    const ids = [...new Set(photoIds.filter(Boolean))];
    ids.forEach((photoId) => {
      const photo = state.photosById.get(photoId);
      const card = elements.grid?.querySelector(`[data-photo-id="${attributeSelectorValue(photoId)}"]`);
      if (!photo || !card) return;
      const selected = isSelectedForActiveProject(photo);
      card.classList.toggle("is-selected", selected);
      const checkbox = card.querySelector("[data-select-photo]");
      if (checkbox) checkbox.checked = selected;
    });
    renderDraft();
    renderWizard();
    syncFileActionLabels();
  };

  const selectionChangeNeedsFullRender = () => (
    state.wizardStep !== 1
    || state.selectedOnly
    || state.sort === "selected"
  );

  const setWizardStep = (step) => {
    flushTitleInputs();
    const next = normalizeWizardStep(step);
    if (next >= 1 && selectedShootIds().length === 0) {
      setStatus("Choose at least one shoot before picking photos");
      state.wizardStep = 0;
    } else if (next >= 2 && activeSelectedPhotos().length === 0) {
      setStatus("Select at least one photo or video before continuing");
      state.wizardStep = 1;
    } else {
      state.wizardStep = next;
    }
    if (state.wizardStep === 2) {
      state.selectedOnly = true;
      if (elements.selectedOnly) elements.selectedOnly.checked = true;
    }
    if (state.wizardStep <= 1) {
      state.selectedOnly = false;
      if (elements.selectedOnly) elements.selectedOnly.checked = false;
    }
    render();
    replaceWizardStepInUrl(state.wizardStep);
    document.getElementById("real-estate-wizard")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const projectListForSelectionChange = (photoId, photo) => {
    const explicit = explicitProjectIdsFor(photoId);
    return state.selectedIds.has(photoId) ? selectedProjectIdsFor(photo) : explicit;
  };

  const applySelectionForPhotoIds = (photoIds, selected) => {
    photoIds.forEach((photoId) => {
      if (!state.photosById.has(photoId)) return;
      const photo = state.photosById.get(photoId);
      const projectId = projectIdFor(photo);
      const current = projectListForSelectionChange(photoId, photo);
      if (selected && projectId) {
        state.projectAssignments[photoId] = [...current, projectId]
          .filter((id, index, items) => id && items.indexOf(id) === index);
        if (!state.selectedOrder.includes(photoId)) state.selectedOrder.push(photoId);
        return;
      }
      if (!selected && projectId) {
        const nextProjects = current.filter((id) => id !== projectId);
        if (nextProjects.length) {
          state.projectAssignments[photoId] = nextProjects;
        } else {
          delete state.projectAssignments[photoId];
          state.selectedOrder = state.selectedOrder.filter((id) => id !== photoId);
        }
      }
    });
    persistProjectAssignments();
    persistSelection();
    invalidateVideoExportCache();
    if (selectionChangeNeedsFullRender()) {
      render();
    } else {
      syncVisibleSelectionState(photoIds);
    }
  };

  const setSelected = (photoId, selected) => {
    applySelectionForPhotoIds([photoId], selected);
  };

  const setSelectedRange = (fromId, toId, selected) => {
    const visible = filteredPhotos().map((photo) => photo.id);
    const fromIndex = visible.indexOf(fromId);
    const toIndex = visible.indexOf(toId);
    if (fromIndex < 0 || toIndex < 0) {
      setSelected(toId, selected);
      return;
    }
    const [start, end] = fromIndex < toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex];
    applySelectionForPhotoIds(visible.slice(start, end + 1), selected);
  };

  const setTitle = (photoId, value) => {
    const photo = state.photosById.get(photoId);
    if (!photo) return;
    const previousTitle = titleFor(photo);
    const clean = String(value || "").trim();
    const fallback = defaultTitleFor(photo);
    if (!clean || clean === fallback) {
      delete state.editedTitles[photoId];
    } else {
      state.editedTitles[photoId] = clean;
    }
    persistTitles();
    renderDraft();
    const nextTitle = titleFor(photo);
    if (nextTitle !== previousTitle) invalidateVideoExportCache();
    elements.grid?.querySelectorAll(`[data-title-photo="${attributeSelectorValue(photoId)}"]`).forEach((input) => {
      if (input !== document.activeElement) input.value = nextTitle;
    });
    if (state.activePhotoId === photoId) {
      if (elements.dialogTitle) elements.dialogTitle.textContent = nextTitle;
      if (elements.dialogTitleInput && elements.dialogTitleInput !== document.activeElement) {
        elements.dialogTitleInput.value = nextTitle;
      }
    }
  };

  const flushTitleInputs = () => {
    elements.grid?.querySelectorAll("[data-title-photo]").forEach((input) => {
      if (input?.dataset?.titlePhoto) setTitle(input.dataset.titlePhoto, input.value);
    });
    if (state.activePhotoId && elements.dialogTitleInput) {
      setTitle(state.activePhotoId, elements.dialogTitleInput.value);
    }
  };

  const setPhotoProject = (photoId, projectId, assigned) => {
    const photo = state.photosById.get(photoId);
    if (!photo) return;
    const current = assignedProjectIdsFor(photo);
    let next = assigned
      ? [...current, projectId]
      : current.filter((id) => id !== projectId);
    next = next.filter((id, index, items) => id && items.indexOf(id) === index);
    if (!next.length) next = [projectIdFor(photo)];
    state.projectAssignments[photoId] = next;
    persistProjectAssignments();
    invalidateVideoExportCache();
    render();
  };

  const timestampId = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const selectedPhotos = () => state.selectedOrder.map((id) => state.photosById.get(id)).filter(Boolean);
  const selectedMediaSummary = (photos = selectedPhotos()) => ({
    photos: photos.filter((photo) => !isVideo(photo)).length,
    videos: photos.filter(isVideo).length,
  });
  const outputProjectIdsFor = (photo, activeOnly = false) => {
    if (activeOnly) return selectedProjectIdsFor(photo);
    return assignedProjectIdsFor(photo);
  };

  const projectGroupsFor = (photos, activeOnly = false) => {
    const groups = new Map();
    photos.forEach((photo) => {
      outputProjectIdsFor(photo, activeOnly).forEach((projectId) => {
        const project = projectOptionFor(projectId, photo);
        if (!groups.has(projectId)) {
          groups.set(projectId, {
            projectId,
            projectTitle: project.projectTitle,
            projectIndex: project.sortIndex,
            photos: [],
          });
        }
        groups.get(projectId).photos.push(photo);
      });
    });
    return [...groups.values()].sort((a, b) => {
      const byIndex = Number(a.projectIndex) - Number(b.projectIndex);
      return byIndex || a.projectTitle.localeCompare(b.projectTitle);
    });
  };

  const batchItemsFor = (photos, project = null) => photos.map((photo, index) => {
    const preview = photo?.media?.publicPreview || {};
    return {
      photoId: photo.id,
      title: titleFor(photo),
      sortIndex: index + 1,
      mediaType: mediaTypeFor(photo),
      durationSeconds: isVideo(photo) ? durationSecondsFor(photo) : null,
      dimensions: pdfDimensionsFor(photo),
      pdfTreatment: isVideo(photo) ? "still-from-video" : "photo",
      pdfStillPercent: isVideo(photo) ? videoStillPercentFor(photo) : null,
      slideshowDurationPolicy: isVideo(photo) ? "preserve-source-duration" : "fixed-photo-duration",
      slideshowDurationSeconds: isVideo(photo) ? durationSecondsFor(photo) : state.slideshowPhotoSeconds,
      transition: slideshowTransition,
      cloudSourceKey: isVideo(photo) ? photo?.cloudPdfSource?.sourceVideoPrivateKey || photo?.realEstate?.privateMasterKey || "" : photo?.cloudPdfSource?.publicKey || "",
      sourceVideoPrivateKey: isVideo(photo) ? photo?.cloudPdfSource?.sourceVideoPrivateKey || photo?.realEstate?.privateMasterKey || "" : "",
      sourceDurationSeconds: isVideo(photo) ? durationSecondsFor(photo) : null,
      publicStillKey: photo?.cloudPdfSource?.publicKey || preview.detailKey || "",
      publicDetailKey: preview.detailKey || photo?.cloudPdfSource?.publicKey || "",
      publicGalleryKey: preview.galleryKey || "",
      publicVideoKey: preview.detailVideoKey || preview.videoKey || preview.previewVideoKey || photo?.media?.video?.publicPreviewKey || "",
      projectId: project?.projectId || projectIdFor(photo),
      projectTitle: project?.projectTitle || projectTitleFor(photo),
      projectIds: project ? [project.projectId] : assignedProjectIdsFor(photo),
    };
  });

  const buildBatchManifest = (photosOverride = selectedPhotos(), activeOnly = false) => {
    flushTitleInputs();
    const template = workflow().batchManifest?.template || {};
    const batchId = timestampId();
    const photos = photosOverride;
    const projects = projectGroupsFor(photos, activeOnly);
    const mediaSummary = selectedMediaSummary(photos);
    const watermarkText = activeWatermarkText();
    return {
      ...template,
      schema: template.schema || workflow().batchManifest?.schema || "photosbyelie.realEstatePdfBatch.v1",
      batchId,
      createdAt: new Date().toISOString(),
      customer: template.customer || state.payload?.customer?.name || "",
      galleryKey: template.galleryKey || state.gallery?.key || "",
      sourceBatchId: template.sourceBatchId || "",
      pdfMode: "one-pdf-per-project",
      outputModes: ["project-pdf", "project-slideshow"],
      mediaSummary,
      pdfSettings: {
        paperFormat: paperFormatFor().key,
        paperLabel: paperFormatFor().label,
        pageOrientation: normalizePdfOrientation(state.pdfOrientation),
        layout: "landscape-two-per-page-portrait-one-per-page",
        fitMode: "contain",
        videoTreatment: "still-from-video",
        videoStillPercent: 10,
        photoWatermark: watermarkText,
        watermarkEnabled: Boolean(watermarkText),
        photoWatermarkPlacement: "bottom-center",
        pageWatermark: watermarkText,
        pageWatermarkPlacement: "footer-center",
      },
      slideshowSettings: {
        ...slideshowSettingsFor(),
      },
      projects: projects.map((project) => ({
        projectId: project.projectId,
        projectTitle: project.projectTitle,
        sortIndex: project.projectIndex,
        items: batchItemsFor(project.photos, project),
      })),
      items: batchItemsFor(photos),
    };
  };

  const selectionRowsFor = (manifest) => {
    const projectRows = Array.isArray(manifest.projects)
      ? manifest.projects.flatMap((project) => (Array.isArray(project.items) ? project.items : []).map((item) => ({
        projectTitle: project.projectTitle || item.projectTitle || "",
        projectSortIndex: Number(project.sortIndex) || 0,
        item,
      })))
      : [];
    const rows = projectRows.length
      ? projectRows
      : (Array.isArray(manifest.items) ? manifest.items.map((item) => ({
        projectTitle: item.projectTitle || "",
        projectSortIndex: 0,
        item,
      })) : []);
    return rows.sort((a, b) => (
      Number(a.projectSortIndex) - Number(b.projectSortIndex)
      || Number(a.item?.sortIndex) - Number(b.item?.sortIndex)
      || String(a.projectTitle).localeCompare(String(b.projectTitle))
    ));
  };

  const slideshowImageKeysFor = (photo) => {
    const preview = photo?.media?.publicPreview || {};
    return [
      preview.detailKey,
      photo?.cloudPdfSource?.publicKey,
      preview.galleryKey,
    ].map((key) => String(key || "").replace(/^\/+/, ""))
      .filter(Boolean)
      .filter((key, index, keys) => keys.indexOf(key) === index);
  };

  const slideshowImageUrlsFor = (photo) => {
    const directUrl = imageFor(photo, "detail");
    const keys = slideshowImageKeysFor(photo);
    const workerUrls = keys.map(workerMediaUrl).filter(Boolean);
    const publicUrls = keys.map(publicMediaUrl).filter(Boolean);
    const candidates = isLocalHost
      ? [directUrl, ...workerUrls, ...publicUrls]
      : [...workerUrls, directUrl, ...publicUrls];
    return candidates.filter(Boolean).filter((url, index, urls) => urls.indexOf(url) === index);
  };

  const selectionPlainTextFor = (manifest) => {
    const rows = selectionRowsFor(manifest);
    return [
      `Photos By Elie selection - ${manifest.customer || state.payload?.customer?.name || "Client"}`,
      `Batch: ${manifest.batchId || ""}`,
      `Created: ${manifest.createdAt || ""}`,
      "",
      ["Project", "Order", "Type", "Duration", "Title", "Media ID"].join("\t"),
      ...rows.map(({ projectTitle, item }) => [
        projectTitle || item.projectTitle || "",
        item.sortIndex || "",
        item.mediaType || "photo",
        item.mediaType === "video"
          ? `preserve source${formatDuration(item.durationSeconds) ? ` (${formatDuration(item.durationSeconds)})` : ""}`
          : `${item.slideshowDurationSeconds || state.slideshowPhotoSeconds}s`,
        item.title || "",
        item.photoId || "",
      ].map((value) => String(value || "").replace(/\s+/g, " ").trim()).join("\t")),
      "",
    ].join("\n");
  };

  const selectionHtmlFor = (manifest) => {
    const rows = selectionRowsFor(manifest);
    const selectedCount = new Set(rows.map(({ item }) => item.photoId).filter(Boolean)).size;
    const projectCount = Array.isArray(manifest.projects) && manifest.projects.length
      ? manifest.projects.length
      : new Set(rows.map(({ projectTitle, item }) => projectTitle || item.projectTitle).filter(Boolean)).size;
    const safeJson = JSON.stringify(manifest, null, 2)
      .replace(/</g, "\\u003c")
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029");
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Photos By Elie Selection ${escapeHtml(manifest.batchId || "")}</title>
  <style>
    :root{color-scheme:light dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.4}
    body{margin:0;background:Canvas;color:CanvasText}
    main{max-width:980px;margin:0 auto;padding:24px 16px 40px}
    h1{margin:0 0 6px;font-size:clamp(1.6rem,5vw,2.4rem)}
    p{margin:0 0 14px}
    .meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:18px 0}
    .meta div{border:1px solid color-mix(in srgb,CanvasText 18%,transparent);padding:10px}
    .meta dt{font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;opacity:.7}
    .meta dd{margin:4px 0 0;font-weight:700}
    table{width:100%;border-collapse:collapse;margin-top:18px;font-size:.95rem}
    th,td{border:1px solid color-mix(in srgb,CanvasText 16%,transparent);padding:9px;text-align:left;vertical-align:top}
    th{position:sticky;top:0;background:Canvas;font-size:.75rem;text-transform:uppercase;letter-spacing:.08em}
    tbody tr:nth-child(even){background:color-mix(in srgb,CanvasText 4%,transparent)}
    code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.86em}
    .note{margin-top:20px;font-size:.9rem;opacity:.72}
  </style>
</head>
<body>
  <main>
    <h1>Photos By Elie selection</h1>
    <p>${escapeHtml(manifest.customer || state.payload?.customer?.name || "Client")} real-estate output draft</p>
    <dl class="meta">
      <div><dt>Batch</dt><dd><code>${escapeHtml(manifest.batchId || "")}</code></dd></div>
      <div><dt>Created</dt><dd>${escapeHtml(dateLabel)}</dd></div>
      <div><dt>Media</dt><dd>${selectedCount}</dd></div>
      <div><dt>Projects</dt><dd>${projectCount}</dd></div>
      <div><dt>Paper</dt><dd>${escapeHtml(manifest.pdfSettings?.paperLabel || manifest.pdfSettings?.paperFormat || "")}</dd></div>
    </dl>
    <table>
      <thead>
        <tr>
          <th>Project</th>
          <th>Order</th>
          <th>Type</th>
          <th>Duration</th>
          <th>Title</th>
          <th>Media ID</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(({ projectTitle, item }) => `
        <tr>
          <td>${escapeHtml(projectTitle || item.projectTitle || "")}</td>
          <td>${escapeHtml(item.sortIndex || "")}</td>
          <td>${escapeHtml(item.mediaType || "photo")}</td>
          <td>${escapeHtml(item.mediaType === "video" ? `preserve source${formatDuration(item.durationSeconds) ? ` (${formatDuration(item.durationSeconds)})` : ""}` : `${item.slideshowDurationSeconds || state.slideshowPhotoSeconds}s`)}</td>
          <td>${escapeHtml(item.title || "")}</td>
          <td><code>${escapeHtml(item.photoId || "")}</code></td>
        </tr>`).join("")}
      </tbody>
    </table>
    <p class="note">This table file can be opened in a browser for review and loaded back into the Photos By Elie Real Estate page to continue editing the selection.</p>
    <script type="application/json" data-re-selection-batch>${safeJson}</script>
  </main>
</body>
</html>
`;
  };

  const buildSlideshowManifest = (photosOverride = selectedPhotos(), activeOnly = false, baseOverride = null) => {
    const base = baseOverride ? cloneBatch(baseOverride) : buildBatchManifest(photosOverride, activeOnly);
    const musicTrack = chooseSlideshowMusicTrack(photosOverride);
    const effectsByPhotoId = new Map((base.items || []).map((item) => [item.photoId, randomKenBurnsEffect()]));
    const slideshowOutputItem = (item) => ({
      ...item,
      outputTreatment: item.mediaType === "video" ? "source-video-full-duration" : "still-photo",
      durationSeconds: item.mediaType === "video" ? item.durationSeconds : state.slideshowPhotoSeconds,
      transition: slideshowTransition,
      effect: effectsByPhotoId.get(item.photoId) || randomKenBurnsEffect(),
    });
    return {
      ...base,
      schema: "photosbyelie.realEstateSlideshowBatch.v1",
      outputMode: "one-slideshow-per-project",
      pdfSettings: undefined,
      slideshowSettings: slideshowSettingsFor(musicTrack),
      projects: (base.projects || []).map((project) => ({
        ...project,
        items: (project.items || []).map(slideshowOutputItem),
      })),
      items: (base.items || []).map(slideshowOutputItem),
    };
  };

  const slideshowSlidesFor = (manifest) => selectionRowsFor(manifest).map(({ projectTitle, item }) => {
    const photo = state.photosById.get(item.photoId);
    if (!photo) return null;
    const video = item.mediaType === "video" || isVideo(photo);
    const dimensions = pdfDimensionsFor(photo);
    return {
      projectTitle: projectTitle || item.projectTitle || "",
      title: item.title || titleFor(photo),
      mediaType: video ? "video" : "photo",
      imageUrl: imageFor(photo, "detail"),
      imageUrls: slideshowImageUrlsFor(photo),
      videoUrl: video ? videoPreviewFor(photo) : "",
      orientation: dimensions.height > dimensions.width ? "portrait" : "landscape",
      aspectRatio: dimensions.width > 0 && dimensions.height > 0 ? dimensions.width / dimensions.height : 1,
      durationMs: Math.max(1000, Number(video ? item.durationSeconds : item.slideshowDurationSeconds || state.slideshowPhotoSeconds) * 1000 || state.slideshowPhotoSeconds * 1000),
      durationLabel: video ? (formatDuration(item.durationSeconds || durationSecondsFor(photo)) || "source duration") : `${item.slideshowDurationSeconds || state.slideshowPhotoSeconds}s`,
      source: item.cloudSourceKey || item.publicStillKey || item.photoId || "",
      effect: item.effect || randomKenBurnsEffect(),
    };
  }).filter(Boolean);

  const slideshowHtmlFor = (manifest) => {
    const audioPolicy = manifest.slideshowSettings?.audioPolicy || {};
    const musicTrack = audioPolicy.musicTrack || null;
    const previewSourceVideoVolume = Number(audioPolicy.sourceVideoAudioLinearGain ?? sourceVideoAudioLinearGain);
    const previewMusicGainDb = Number(audioPolicy.musicGainDb ?? slideshowMusicGainDb);
    const outputOrientation = manifest.slideshowSettings?.outputOrientation === "portrait" ? "portrait" : "landscape";
    const outputRatio = outputOrientation === "portrait" ? 9 / 16 : 16 / 9;
    const slideshowWatermarkText = String(manifest.slideshowSettings?.watermarkText || "").trim();
    const slides = slideshowSlidesFor(manifest);
    const musicCredits = slideshowRequiredCreditsFor(manifest);
    const creditDurationMs = slideshowCreditDurationMsFor(musicCredits);
    const returnUrl = previewReturnUrl();
    const safeJson = JSON.stringify(manifest, null, 2)
      .replace(/</g, "\\u003c")
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029");
    const safeSlidesJson = JSON.stringify(slides)
      .replace(/</g, "\\u003c")
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029");
    const safeMusicJson = JSON.stringify(musicTrack)
      .replace(/</g, "\\u003c")
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029");
    const safeCreditsJson = JSON.stringify(musicCredits)
      .replace(/</g, "\\u003c")
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029");
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Photos By Elie Slideshow ${escapeHtml(manifest.batchId || "")}</title>
  <style>
    :root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.4;background:#0d0d0d;color:#f7f7f7}
    *{box-sizing:border-box}
    body{margin:0;background:#0d0d0d;color:#f7f7f7}
    main{min-height:100dvh;display:grid;grid-template-rows:minmax(0,1fr) auto;place-items:center stretch}
    .stage{position:relative;display:grid;width:100vw;height:calc(100dvh - 70px);background:#050505;place-items:center;align-self:center;justify-self:center;overflow:hidden}
    .frame{position:absolute;inset:0;display:grid;place-items:center;background:#050505;overflow:hidden}
    .frame video{width:100%;height:100%;object-fit:contain;background:#050505}
    .video-wrap{position:absolute;inset:0;display:grid;place-items:center;background:#050505}
    .photo-slide{position:absolute;inset:0;display:grid;place-items:center;overflow:hidden;background:#050505}
    .photo-slide img{display:block;background:transparent}
    .slide-backdrop{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:blur(24px);opacity:.48;transform:scale(1.1)}
    .photo-content{position:absolute;inset:0;z-index:1;display:flex;align-items:center;justify-content:center;overflow:visible;animation:kenBurns var(--slide-duration,4s) ease-in-out both;will-change:transform}
    .photo-card{position:relative;z-index:1;display:block;overflow:hidden}
    .slide-photo{position:absolute;inset:0;z-index:1;width:100%;height:100%;object-fit:cover}
    .photo-watermark-sheet{position:absolute;inset:-32%;z-index:2;display:grid;grid-template-columns:repeat(4,max-content);align-content:center;justify-content:center;gap:clamp(90px,18vmin,260px) clamp(110px,22vmin,300px);pointer-events:none;transform:rotate(-28deg)}
    .photo-watermark-sheet span{display:block;color:rgba(255,255,255,.168);font-size:clamp(1.35rem,4.2vmin,4.6rem);font-weight:900;letter-spacing:.02em;text-shadow:0 0 1px rgba(0,0,0,.13),0 1px 2px rgba(0,0,0,.13);text-transform:uppercase;white-space:nowrap}
    .photo-watermark-sheet span:nth-child(4n+2),.photo-watermark-sheet span:nth-child(4n+4){transform:translateX(-48%)}
    .photo-watermark-corner{position:absolute;right:clamp(14px,2.2vmin,38px);bottom:clamp(14px,2.2vmin,38px);z-index:3;color:rgba(255,255,255,.72);font-size:clamp(.85rem,2.2vmin,1.45rem);font-weight:900;text-shadow:0 1px 2px rgba(0,0,0,.48)}
    .photo-title{position:absolute;left:0;right:0;bottom:0;z-index:4;padding:clamp(34px,7vmin,92px) clamp(14px,3vmin,34px) clamp(36px,6vmin,68px);background:linear-gradient(to top,rgba(0,0,0,.62),rgba(0,0,0,0));color:#fff;text-align:center;text-shadow:0 2px 10px rgba(0,0,0,.82);pointer-events:none}
    .photo-title p{margin:0 auto .2em;font-size:clamp(.62rem,1.65vmin,1rem);font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.84)}
    .photo-title h1{margin:0 auto;max-width:min(760px,82%);font-size:clamp(1.35rem,4.8vmin,4.2rem);line-height:.98}
    .credits-card{position:absolute;inset:0;display:grid;place-items:center;padding:clamp(24px,7vw,90px);background:#050505;text-align:center}
    .credits-card-inner{display:grid;gap:clamp(10px,2.4vmin,20px);max-width:min(820px,86vw)}
    .credits-card p{margin:0;color:rgba(255,255,255,.72);font-size:clamp(.8rem,2vmin,1.1rem);font-weight:900;letter-spacing:.1em;text-transform:uppercase}
    .credits-card strong{display:block;color:#fff;font-size:clamp(1.15rem,3.4vmin,2.4rem);line-height:1.08;text-shadow:0 2px 10px rgba(0,0,0,.72)}
    .credits-card small{display:block;color:rgba(255,255,255,.64);font-size:clamp(.72rem,1.6vmin,1rem);font-weight:700;line-height:1.35}
    @keyframes kenBurns{from{transform:scale(var(--start-scale,1.03)) translate(var(--start-x,0),var(--start-y,0))}to{transform:scale(var(--end-scale,1.1)) translate(var(--end-x,0),var(--end-y,0))}}
    .slide-count{position:absolute;left:clamp(10px,2.4vw,22px);bottom:clamp(10px,2.4vw,22px);z-index:4;border-radius:4px;background:rgba(80,80,80,.78);color:#fff;padding:3px 7px;font-size:.78rem;font-weight:850;line-height:1;text-shadow:none}
    .watermark{position:absolute;left:0;right:0;bottom:8px;text-align:center;color:rgba(255,255,255,.52);font-size:.76rem;font-weight:700;text-shadow:0 1px 6px #000}
    .controls{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:8px;border-top:1px solid rgba(255,255,255,.14);background:#171717;padding:14px}
    button{min-height:42px;border:1px solid rgba(255,255,255,.2);border-radius:999px;background:#242424;color:#fff;padding:8px 18px;font:inherit;font-weight:800;cursor:pointer}
    .close-preview{background:#f7f7f7;color:#111;border-color:#f7f7f7}
    button:hover{background:#303030}
    .close-preview:hover{background:#fff}
    @media (max-width:700px){
      main{display:grid;min-height:100dvh}
      .photo-slide{padding:0}
      .frame video{padding:0}
      .photo-title{padding-top:clamp(28px,8vmin,72px);padding-bottom:clamp(34px,8vmin,56px)}
      .photo-title h1{font-size:clamp(1.15rem,7vw,2.3rem)}
      .photo-title p{font-size:.72rem}
      .controls{position:sticky;bottom:0;z-index:5;padding:10px calc(10px + env(safe-area-inset-right,0px)) calc(10px + env(safe-area-inset-bottom,0px)) calc(10px + env(safe-area-inset-left,0px))}
      button{min-height:38px;padding:7px 14px}
    }
  </style>
</head>
<body class="video-${outputOrientation}">
  <main>
    <section class="stage" aria-label="Browser video preview">
      <div class="frame" data-frame></div>
      ${musicTrack?.absoluteSrc || musicTrack?.src ? `<audio data-music preload="auto" loop src="${escapeHtml(musicTrack.absoluteSrc || musicTrack.src)}"></audio>` : ""}
      ${slideshowWatermarkText ? `<div class="watermark">${escapeHtml(slideshowWatermarkText)}</div>` : ""}
    </section>
    <div class="controls">
      <button class="close-preview" type="button" data-close-preview>Close preview</button>
      <button type="button" data-play>${musicTrack?.absoluteSrc || musicTrack?.src ? "Play with sound" : "Pause"}</button>
    </div>
    <script type="application/json" data-re-selection-batch>${safeJson}</script>
    <script>
      const slides = ${safeSlidesJson};
      const musicTrack = ${safeMusicJson};
      const musicCredits = ${safeCreditsJson};
      const creditDurationMs = ${Number(creditDurationMs)};
      const watermarkText = ${JSON.stringify(slideshowWatermarkText)};
      const videoRatio = ${Number(outputRatio).toFixed(6)};
      const stage = document.querySelector(".stage");
      const frame = document.querySelector("[data-frame]");
      const music = document.querySelector("[data-music]");
      const playButton = document.querySelector("[data-play]");
      const closeButton = document.querySelector("[data-close-preview]");
      const returnUrl = ${JSON.stringify(returnUrl)};
      let index = 0;
      let timer = 0;
      let fadeFrame = 0;
      let fadeInterval = 0;
      let fadeDone = null;
      let playing = true;
      let showingCredits = false;
      let soundBlocked = Boolean(music);
      const sourceVideoVolume = Math.min(1, Math.max(0, ${Number(previewSourceVideoVolume).toFixed(4)}));
      const musicVolume = Math.pow(10, Number(musicTrack?.musicGainDb ?? ${previewMusicGainDb}) / 20);
      const attr = (value) => String(value || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const effectStyle = (effect, durationMs) => {
        const presets = {
          "center-breathe-in": [1.0, 1.024, "0%", "0%", "0%", "0%"],
          "center-breathe-out": [1.024, 1.0, "0%", "0%", "0%", "0%"],
          "center-drift-left": [1.012, 1.024, "0%", "0%", "-0.35%", "0%"],
          "center-drift-right": [1.012, 1.024, "0%", "0%", "0.35%", "0%"],
          "center-drift-up": [1.012, 1.024, "0%", "0%", "0%", "-0.35%"],
          "center-drift-down": [1.012, 1.024, "0%", "0%", "0%", "0.35%"],
        };
        const [startScale, endScale, startX, startY, endX, endY] = presets[effect] || presets["center-breathe-in"];
        return "--slide-duration:" + durationMs + "ms;--start-scale:" + startScale + ";--end-scale:" + endScale + ";--start-x:" + startX + ";--start-y:" + startY + ";--end-x:" + endX + ";--end-y:" + endY;
      };
      const counterHtml = (counterText) => '<strong class="slide-count">' + attr(counterText) + '</strong>';
      const photoCardStyle = (slide) => {
        const rect = stage?.getBoundingClientRect?.();
        const stageWidth = Math.max(1, rect?.width || window.innerWidth || 1);
        const stageHeight = Math.max(1, rect?.height || window.innerHeight || 1);
        const ratio = Math.max(0.05, Number(slide?.aspectRatio || 1));
        let width = stageWidth;
        let height = width / ratio;
        if (height > stageHeight) {
          height = stageHeight;
          width = height * ratio;
        }
        return "width:" + Math.round(width) + "px;height:" + Math.round(height) + "px";
      };
      const watermarkSheetHtml = () => {
        const text = String(watermarkText || "").trim().toUpperCase();
        if (!text) return "";
        return '<div class="photo-watermark-sheet" aria-hidden="true">' + Array.from({ length: 28 }, () => '<span>' + attr(text) + '</span>').join("") + '</div><b class="photo-watermark-corner" aria-hidden="true">PhotosByElie</b>';
      };
      const photoTitleHtml = (slide) => {
        const projectTitle = String(slide.projectTitle || "").trim();
        const titleText = String(slide.title || "Untitled").trim();
        return '<div class="photo-title"><p>' + attr(projectTitle || slide.mediaType || "") + '</p><h1>' + attr(titleText) + '</h1></div>';
      };
      const photoSlideHtml = (slide, counterText) => {
        const source = attr(slide.imageUrl);
        const style = attr(effectStyle(slide.effect, Math.max(1000, slide.durationMs || 4000)));
        const cardStyle = attr(photoCardStyle(slide));
        const orientation = slide.orientation === "portrait" ? "portrait" : "landscape";
        return '<div class="photo-slide is-' + orientation + '"><img class="slide-backdrop" aria-hidden="true" alt="" src="' + source + '"><div class="photo-content" style="' + style + '"><div class="photo-card" style="' + cardStyle + '"><img class="slide-photo" alt="" src="' + source + '">' + watermarkSheetHtml() + photoTitleHtml(slide) + counterHtml(counterText) + '</div></div></div>';
      };
      const creditsHtml = () => {
        const entries = Array.isArray(musicCredits) ? musicCredits : [];
        return '<div class="credits-card"><div class="credits-card-inner"><p>Music credit</p>' + entries.map((entry) => {
          const text = attr(entry?.text || "");
          const detail = [entry?.source, entry?.license].filter(Boolean).join(" / ");
          return '<strong>' + text + '</strong>' + (detail ? '<small>' + attr(detail) + '</small>' : '');
        }).join("") + '</div></div>';
      };

      const clearTimer = () => {
        if (timer) window.clearTimeout(timer);
        timer = 0;
      };
      const clearMusicFade = () => {
        if (fadeFrame) window.cancelAnimationFrame(fadeFrame);
        if (fadeInterval) window.clearInterval(fadeInterval);
        fadeFrame = 0;
        fadeInterval = 0;
        fadeDone = null;
      };
      const clampVolume = (value) => Math.max(0, Math.min(1, Number(value) || 0));
      const beginMusicFade = (durationMs, onDone = null) => {
        if (!music) return;
        clearMusicFade();
        const startedAt = performance.now();
        const fadeDuration = Math.max(300, Number(durationMs) || 300);
        const startVolume = clampVolume(music.volume || musicVolume);
        fadeDone = typeof onDone === "function" ? onDone : null;
        const tick = () => {
          const elapsed = performance.now() - startedAt;
          const remaining = Math.max(0, 1 - (elapsed / fadeDuration));
          music.volume = clampVolume(startVolume * remaining);
          if (remaining > 0) {
            if (!fadeFrame) fadeFrame = window.requestAnimationFrame(() => {
              fadeFrame = 0;
              tick();
            });
            return;
          }
          const done = fadeDone;
          clearMusicFade();
          music.volume = 0;
          if (done) done();
        };
        fadeInterval = window.setInterval(tick, 80);
        tick();
      };
      const applyStageSize = () => {
        if (!stage) return;
        const controls = document.querySelector(".controls");
        const controlHeight = controls ? controls.getBoundingClientRect().height : 70;
        const maxWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
        const maxHeight = Math.max(220, (window.innerHeight || document.documentElement.clientHeight || 1) - controlHeight);
        let width = maxWidth;
        let height = width / videoRatio;
        if (height > maxHeight) {
          height = maxHeight;
          width = height * videoRatio;
        }
        stage.style.width = Math.round(width) + "px";
        stage.style.height = Math.round(height) + "px";
        const card = frame?.querySelector?.(".photo-card");
        if (card && slides[index]) card.setAttribute("style", photoCardStyle(slides[index]));
      };
      window.addEventListener("resize", applyStageSize);
      const syncPlayButton = () => {
        if (!playButton) return;
        playButton.textContent = soundBlocked ? "Play with sound" : (playing ? "Pause" : "Play");
      };
      const playMusic = async () => {
        if (!music) {
          soundBlocked = false;
          syncPlayButton();
          return true;
        }
        clearMusicFade();
        music.volume = musicVolume;
        try {
          await music.play();
          soundBlocked = false;
          syncPlayButton();
          return true;
        } catch {
          soundBlocked = true;
          syncPlayButton();
          return false;
        }
      };
      const pauseMusic = () => {
        clearMusicFade();
        if (music) music.pause();
      };
      const stopMusicAtEnd = () => {
        if (!music) return;
        music.volume = 0;
        music.pause();
      };
      const finishPlayback = () => {
        playing = false;
        stopMusicAtEnd();
        syncPlayButton();
      };
      const syncMusicFade = (slide) => {
        if (!music) return;
        if (!playing || index !== slides.length - 1) {
          clearMusicFade();
          music.volume = musicVolume;
          return;
        }
        const duration = Math.max(1000, Number(slide?.durationMs || ${Number(state.slideshowPhotoSeconds) * 1000}));
        beginMusicFade(duration);
      };
      const render = () => {
        clearTimer();
        applyStageSize();
        if (showingCredits) {
          frame.innerHTML = creditsHtml();
          if (playing) timer = window.setTimeout(finishPlayback, Math.max(1000, creditDurationMs || 3500));
          return;
        }
        const slide = slides[index];
        const counterText = (index + 1) + "/" + slides.length;
        if (!slide) {
          frame.innerHTML = "";
          return;
        }
        if (playing) playMusic();
        syncMusicFade(slide);
        if (slide.mediaType === "video" && slide.videoUrl) {
          frame.innerHTML = '<div class="video-wrap"><video controls playsinline poster="' + attr(slide.imageUrl) + '" src="' + attr(slide.videoUrl) + '"></video>' + counterHtml(counterText) + '</div>';
          const video = frame.querySelector("video");
          video.volume = sourceVideoVolume;
          video.addEventListener("ended", () => playing && next());
          video.addEventListener("error", () => {
            frame.innerHTML = photoSlideHtml(slide, counterText);
            if (playing) timer = window.setTimeout(next, Math.max(1000, slide.durationMs || 4000));
          });
          if (playing) video.play().catch(() => {});
        } else {
          frame.innerHTML = photoSlideHtml(slide, counterText);
          if (playing) timer = window.setTimeout(next, Math.max(1000, slide.durationMs || 4000));
        }
      };
      const next = () => {
        if (!slides.length) {
          index = 0;
          render();
          return;
        }
        if (index >= slides.length - 1) {
          if (musicCredits.length && !showingCredits) {
            showingCredits = true;
            render();
            return;
          }
          playing = false;
          if (music && music.volume > 0.01) {
            beginMusicFade(600, stopMusicAtEnd);
          } else {
            stopMusicAtEnd();
          }
          syncPlayButton();
          return;
        }
        index += 1;
        render();
      };
      playButton?.addEventListener("click", async () => {
        if (soundBlocked) {
          if (!playing && (index >= slides.length - 1 || showingCredits)) {
            index = 0;
            showingCredits = false;
          }
          playing = true;
          await playMusic();
          const video = frame.querySelector("video");
          if (video) video.play().catch(() => {});
          render();
          return;
        }
        const replayFromEnd = !playing && (index >= slides.length - 1 || showingCredits);
        playing = !playing;
        if (playing && replayFromEnd) {
          index = 0;
          showingCredits = false;
        }
        syncPlayButton();
        if (music && playing && index === 0) music.volume = musicVolume;
        const video = frame.querySelector("video");
        if (video) {
          if (playing) {
            playMusic();
            video.play().catch(() => {});
          } else {
            pauseMusic();
            video.pause();
          }
        } else if (playing) {
          playMusic();
        } else {
          pauseMusic();
        }
        render();
      });
      closeButton?.addEventListener("click", () => {
        try {
          window.close();
          window.setTimeout(() => {
            if (!document.hidden) window.location.href = returnUrl;
          }, 250);
          if (window.opener && !window.opener.closed) {
            window.close();
            return;
          }
        } catch {}
        window.location.href = returnUrl;
      });
      syncPlayButton();
      render();
    </script>
  </main>
</body>
</html>
`;
  };

  const copyBatch = async () => {
    if (!requireUnlocked()) return;
    const manifest = buildBatchManifest(activeSelectedPhotos(), true);
    const batch = selectionPlainTextFor(manifest);
    try {
      await navigator.clipboard.writeText(batch);
      setStatus(`Copied ${manifest.projects.length} project selection list${manifest.projects.length === 1 ? "" : "s"}`);
    } catch {
      setStatus("Clipboard unavailable; use Save selection");
    }
  };

  const triggerDownload = (blob, filename) => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 60000);
  };

  const downloadBlob = async (blob, filename) => {
    triggerDownload(blob, filename);
    return { filename, pickedLocation: false, bytes: Number(blob.size) || 0 };
  };

  const reserveOutputWindow = (label) => {
    const popup = window.open("about:blank", "_blank");
    if (!popup) return null;
    try {
      popup.document.title = label || "Preparing output";
      popup.document.body.style.margin = "0";
      popup.document.body.style.fontFamily = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
      popup.document.body.style.display = "grid";
      popup.document.body.style.minHeight = "100vh";
      popup.document.body.style.placeItems = "center";
      popup.document.body.innerHTML = `<main style="padding:24px;text-align:center"><h1 style="margin:0 0 8px">${escapeHtml(label || "Preparing output")}</h1><p style="margin:0;color:#666">Photos By Elie is building the browser view.</p></main>`;
    } catch {
      // Some browsers restrict about:blank writes; the reserved tab can still be navigated.
    }
    return popup;
  };

  const showOutputWindowError = (reservedWindow, title, detail) => {
    if (!reservedWindow || reservedWindow.closed) return;
    try {
      reservedWindow.document.open();
      reservedWindow.document.write(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${escapeHtml(title || "Output failed")}</title>
  <style>
    :root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f6f6f4;color:#151515}
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f6f4}
    main{width:min(680px,calc(100% - 32px));border:1px solid #d7d2ca;background:#fff;padding:22px}
    h1{margin:0 0 10px;font-size:clamp(1.6rem,7vw,3rem);line-height:1}
    p{margin:0;color:#555;font-size:1rem;line-height:1.45}
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title || "Needs attention")}</h1>
    <p>${escapeHtml(detail || "The output could not be prepared. Return to the Photos By Elie page and try again.")}</p>
  </main>
</body>
</html>`);
      reservedWindow.document.close();
    } catch {
      // The status panel in the original page still carries the failure message.
    }
  };

  const openBlobInBrowser = async (blob, filename, reservedWindow = null) => {
    const url = URL.createObjectURL(blob);
    if (reservedWindow && !reservedWindow.closed) {
      reservedWindow.location.href = url;
      window.setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000);
      return { method: "open", filename, bytes: Number(blob.size) || 0 };
    }
    const opened = window.open(url, "_blank", "noopener");
    if (opened) {
      window.setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000);
      return { method: "open", filename, bytes: Number(blob.size) || 0 };
    }
    try {
      window.location.assign(url);
      return { method: "open-current", filename, bytes: Number(blob.size) || 0 };
    } catch {
      URL.revokeObjectURL(url);
    }
    return { method: "download", ...(await downloadBlob(blob, filename)) };
  };

  const openHtmlInBrowser = async (html, filename, reservedWindow = null) => {
    const writeWindow = (target) => {
      try {
        target.document.open();
        target.document.write(html);
        target.document.close();
        target.document.title = filename || "Photos By Elie preview";
        try {
          target.opener = null;
        } catch {}
        return true;
      } catch {
        return false;
      }
    };
    if (reservedWindow && !reservedWindow.closed && writeWindow(reservedWindow)) {
      return { method: "open", filename, bytes: new Blob([html], { type: "text/html" }).size };
    }
    const opened = window.open("about:blank", "_blank");
    if (opened && writeWindow(opened)) {
      return { method: "open", filename, bytes: new Blob([html], { type: "text/html" }).size };
    }
    const blob = new Blob([html], { type: "text/html" });
    return openBlobInBrowser(blob, filename, reservedWindow);
  };

  const fileForShare = (blob, filename) => (
    typeof File === "function"
      ? new File([blob], filename, { type: blob.type || "text/html" })
      : null
  );

  const shouldUseNativeFileShare = () => {
    const coarsePointer = window.matchMedia?.("(pointer: coarse)")?.matches === true;
    const phoneWidth = window.matchMedia?.("(max-width: 900px)")?.matches === true;
    const touchTablet = Number(navigator.maxTouchPoints || 0) > 1 && (window.innerWidth || 0) <= 1180;
    return coarsePointer || phoneWidth || touchTablet;
  };

  const shareOrOpenBlob = async ({ blob, filename, title, text, openFallback = true, reservedWindow = null, allowNativeShare = true }) => {
    const file = fileForShare(blob, filename);
    if (allowNativeShare && file && navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        const sharePromise = navigator.share({
          title,
          text,
          files: [file],
        });
        const settled = await Promise.race([
          sharePromise.then(() => "complete"),
          sharePromise.then(null, (error) => {
            throw error;
          }),
          new Promise((resolve) => window.setTimeout(() => resolve("opened"), 500)),
        ]);
        if (settled === "opened") {
          sharePromise.catch((error) => {
            if (error?.name !== "AbortError") console.warn("Device share failed after opening", error);
          });
        }
        if (reservedWindow && !reservedWindow.closed) reservedWindow.close();
        return { method: settled === "opened" ? "share-opened" : "share", filename, bytes: Number(blob.size) || 0 };
      } catch (error) {
        if (error?.name === "AbortError") {
          if (reservedWindow && !reservedWindow.closed) reservedWindow.close();
          throw error;
        }
      }
    }

    if (openFallback) {
      return openBlobInBrowser(blob, filename, reservedWindow);
    }
    return { method: "download", ...(await downloadBlob(blob, filename)) };
  };

  const filenameFromDisposition = (headerValue, fallback = "photos-by-elie.pdf") => {
    const encoded = String(headerValue || "").match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const plain = String(headerValue || "").match(/filename="?([^";]+)"?/i)?.[1];
    let candidate = plain;
    if (encoded) {
      try {
        candidate = decodeURIComponent(encoded);
      } catch {
        candidate = encoded;
      }
    }
    return String(candidate || fallback).split(/[\\/]/).pop() || fallback;
  };

  const downloadReadyOutputUrl = async ({ url, format = "", filename = "" } = {}) => {
    if (format !== "pdf" || !shouldUseNativeFileShare()) {
      await openDeliverableUrl(url, "download");
      return;
    }
    const rawUrl = String(url || "").trim();
    const baseUrl = String(workerBaseUrl() || "").replace(/\/+$/, "");
    const href = new URL(rawUrl, baseUrl ? `${baseUrl}/` : window.location.href).href;
    const response = await fetch(href, { credentials: "include" });
    if (!response.ok) throw new Error(`PDF download failed (${response.status})`);
    const resolvedFilename = filenameFromDisposition(
      response.headers.get("content-disposition"),
      filename || "photos-by-elie.pdf"
    );
    const bytes = await response.arrayBuffer();
    const saved = await downloadBlob(new Blob([bytes], { type: "application/octet-stream" }), resolvedFilename);
    setStatus(`Downloaded ${saved.filename} to Downloads (${formatBytes(saved.bytes)})`);
  };

  const shareSelectionTable = async () => {
    if (!requireUnlocked() || state.outputBusy) return;
    const batch = buildBatchManifest(activeSelectedPhotos(), true);
    if (!batch.items?.length) {
      setStatus("Select media before saving a selection");
      return;
    }
    startOutputProgress({
      title: "Saving selection",
      detail: "Building the selection manifest...",
      total: 2,
      kind: "selection",
    });
    updateOutputProgress({
      title: "Saving selection",
      detail: "Formatting selected media...",
      current: 1,
      total: 2,
    });
    try {
      const blob = new Blob([selectionHtmlFor(batch)], { type: "text/html" });
      const filename = `${state.gallery?.key || "real-estate"}-${batch.batchId}-selection.html`;
      saveLocalDeliverable({ type: "selection", batch, filename, bytes: blob.size });
      const saved = await shareOrOpenBlob({
        blob,
        filename,
        title: "Photos By Elie selection",
        text: `${batch.customer || "Client"} selection table`,
      });
      if (saved.method === "share" || saved.method === "share-opened") {
        setStatus(`Shared ${saved.filename} (${formatBytes(saved.bytes)})`);
      } else if (saved.method === "open") {
        setStatus(`Opened ${saved.filename}; use the browser share or save controls`);
      } else {
        setStatus(`Downloaded ${saved.filename} to Downloads (${formatBytes(saved.bytes)})`);
      }
      completeOutputProgress(`Saved selection to the shelf: ${saved.filename} (${formatBytes(saved.bytes)})`);
    } catch (error) {
      const message = error?.name === "AbortError" ? "Save canceled" : "Selection could not be saved";
      setStatus(message);
      failOutputProgress(message);
    }
  };

  const supportedSlideshowVideoMimeTypes = () => {
    if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return [];
    return slideshowVideoMimeTypes.filter((mimeType) => MediaRecorder.isTypeSupported(mimeType));
  };

  const preferredSlideshowVideoMimeType = () => supportedSlideshowVideoMimeTypes()[0] || "";

  const slideshowVideoExtensionFor = (mimeType = "") => (
    String(mimeType).toLowerCase().includes("mp4") ? "mp4" : "webm"
  );

  const canRecordSlideshowVideo = () => {
    if (typeof MediaRecorder === "undefined") return false;
    const canvas = document.createElement("canvas");
    return typeof canvas.captureStream === "function" && Boolean(preferredSlideshowVideoMimeType());
  };

  const slideshowVideoSizesFor = (manifest) => (
    manifest?.slideshowSettings?.outputOrientation === "portrait"
      ? [
        { width: 576, height: 1024 },
        { width: 540, height: 960 },
        { width: 720, height: 1280 },
      ]
      : [{ width: 1280, height: 720 }]
  );

  const slideshowVideoSizeFor = (manifest) => slideshowVideoSizesFor(manifest)[0];

  const videoExportAbortError = () => {
    const error = new Error("Video export canceled");
    error.name = "AbortError";
    return error;
  };

  const throwIfVideoExportAborted = (signal) => {
    if (signal?.aborted) throw videoExportAbortError();
  };

  const waitForVideoExportDelay = (ms) => new Promise((resolve) => window.setTimeout(resolve, Math.max(0, Number(ms) || 0)));

  const waitForRecorderStop = async (recorder, stopped, signal, timeoutMs = 7000) => {
    if (!stopped) return "missing";
    let timeoutId = 0;
    const timeout = new Promise((resolve) => {
      timeoutId = window.setTimeout(() => resolve("timeout"), Math.max(1000, Number(timeoutMs) || 7000));
    });
    const abort = signal
      ? new Promise((_, reject) => {
        if (signal.aborted) {
          reject(videoExportAbortError());
          return;
        }
        signal.addEventListener("abort", () => reject(videoExportAbortError()), { once: true });
      })
      : null;
    try {
      return await Promise.race([stopped.then(() => "stopped"), timeout, ...(abort ? [abort] : [])]);
    } finally {
      if (timeoutId) window.clearTimeout(timeoutId);
      if (recorder?.state !== "inactive") {
        try { recorder.requestData?.(); } catch {}
      }
    }
  };

  const objectFitBox = (dimensions, box, fit = "contain") => {
    const width = Math.max(1, Number(dimensions?.width) || 1);
    const height = Math.max(1, Number(dimensions?.height) || 1);
    const scale = fit === "cover"
      ? Math.max(box.width / width, box.height / height)
      : Math.min(box.width / width, box.height / height);
    const targetWidth = width * scale;
    const targetHeight = height * scale;
    return {
      x: box.x + ((box.width - targetWidth) / 2),
      y: box.y + ((box.height - targetHeight) / 2),
      width: targetWidth,
      height: targetHeight,
    };
  };

  const roundedRectPath = (context, x, y, width, height, radius) => {
    const safeRadius = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + safeRadius, y);
    context.lineTo(x + width - safeRadius, y);
    context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
    context.lineTo(x + width, y + height - safeRadius);
    context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
    context.lineTo(x + safeRadius, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
    context.lineTo(x, y + safeRadius);
    context.quadraticCurveTo(x, y, x + safeRadius, y);
    context.closePath();
  };

  const fittedSlideshowText = (context, value, maxWidth) => {
    const text = String(value || "");
    if (context.measureText(text).width <= maxWidth) return text;
    const ellipsis = "...";
    let low = 0;
    let high = text.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (context.measureText(`${text.slice(0, mid)}${ellipsis}`).width <= maxWidth) low = mid;
      else high = mid - 1;
    }
    return `${text.slice(0, low)}${ellipsis}`;
  };

  const loadSlideshowImageElement = (url, { crossOrigin = "anonymous" } = {}) => new Promise((resolve, reject) => {
    const image = new Image();
    if (crossOrigin) image.crossOrigin = crossOrigin;
    const timer = window.setTimeout(() => {
      image.onload = null;
      image.onerror = null;
      image.src = "";
      reject(new Error(`Timed out loading slideshow image: ${url}`));
    }, slideshowAssetTimeoutMs);
    image.onload = () => {
      window.clearTimeout(timer);
      resolve(image);
    };
    image.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error(`Could not load slideshow image: ${url}`));
    };
    image.decoding = "async";
    image.src = url;
  });

  const slideshowImageCandidates = (input) => {
    const urls = (Array.isArray(input) ? input : [input]).map((url) => String(url || "")).filter(Boolean);
    const candidates = [];
    urls.forEach((url) => {
      [url, url.replace(/_1800(\.[a-z0-9]+)([?#].*)?$/i, "_900$1$2")].forEach((candidate) => {
        if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
      });
    });
    return candidates;
  };

  const loadSlideshowImageViaBlob = async (url) => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), slideshowAssetTimeoutMs);
    let objectUrl = "";
    try {
      const response = await fetch(url, { mode: "cors", cache: "force-cache", signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      objectUrl = URL.createObjectURL(blob);
      const image = await loadSlideshowImageElement(objectUrl, { crossOrigin: "" });
      image._photosByElieObjectUrl = objectUrl;
      return image;
    } catch (error) {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (error?.name === "AbortError") throw new Error(`Timed out fetching slideshow image: ${url}`);
      throw error;
    } finally {
      window.clearTimeout(timer);
    }
  };

  const loadSlideshowImage = async (url) => {
    let lastError = null;
    for (const candidate of slideshowImageCandidates(url)) {
      try {
        return await loadSlideshowImageElement(candidate);
      } catch (error) {
        lastError = error;
      }
      try {
        return await loadSlideshowImageViaBlob(candidate);
      } catch (error) {
        lastError = error;
      }
    }
    const label = Array.isArray(url) ? (url[0] || "configured slideshow image") : url;
    throw new Error(`Could not load slideshow image: ${label}${lastError?.message ? ` (${lastError.message})` : ""}`);
  };

  const loadSlideshowVideo = (url, posterUrl = "") => new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    if (posterUrl) video.poster = posterUrl;
    video.addEventListener("loadedmetadata", () => resolve(video), { once: true });
    video.addEventListener("error", () => reject(new Error(`Could not load slideshow video: ${url}`)), { once: true });
    video.src = url;
    video.load();
  });

  const loadSlideshowMedia = async (slide) => {
    if (slide.mediaType === "video" && slide.videoUrl) {
      try {
        const video = await loadSlideshowVideo(slide.videoUrl, slide.imageUrl);
        return {
          kind: "video",
          element: video,
          dimensions: {
            width: video.videoWidth || 1280,
            height: video.videoHeight || 720,
          },
        };
      } catch {
        // Use the still frame if the browser cannot decode the source clip for canvas recording.
      }
    }
    const image = await loadSlideshowImage(slide.imageUrls?.length ? slide.imageUrls : slide.imageUrl);
    return {
      kind: "image",
      element: image,
      dimensions: {
        width: image.naturalWidth || 1800,
        height: image.naturalHeight || 1200,
      },
    };
  };

  const kenBurnsFrameTransform = (effect, progress, canvas) => {
    const p = Math.max(0, Math.min(1, Number(progress) || 0));
    const driftX = canvas.width * 0.018;
    const driftY = canvas.height * 0.018;
    if (effect === "center-breathe-out") return { scale: 1.024 - (0.024 * p), x: 0, y: 0 };
    if (effect === "center-drift-left") return { scale: 1.012 + (0.012 * p), x: -driftX * p, y: 0 };
    if (effect === "center-drift-right") return { scale: 1.012 + (0.012 * p), x: driftX * p, y: 0 };
    if (effect === "center-drift-up") return { scale: 1.012 + (0.012 * p), x: 0, y: -driftY * p };
    if (effect === "center-drift-down") return { scale: 1.012 + (0.012 * p), x: 0, y: driftY * p };
    return { scale: 1 + (0.024 * p), x: 0, y: 0 };
  };

  const drawSlideshowMedia = (context, media, box, fit = "contain") => {
    const rect = objectFitBox(media.dimensions, box, fit);
    context.drawImage(media.element, rect.x, rect.y, rect.width, rect.height);
    return rect;
  };

  const drawVideoWatermark = (context, text, box) => {
    const watermarkText = String(text || "").trim();
    if (!watermarkText || !box.width || !box.height) return;
    const repeated = watermarkText.toUpperCase();
    const fontSize = Math.max(22, Math.round(Math.min(box.width, box.height) / 18));
    const stepX = Math.max(190, Math.round(fontSize * repeated.length * 0.78));
    const stepY = Math.max(150, Math.round(fontSize * 3.4));

    context.save();
    context.beginPath();
    context.rect(box.x, box.y, box.width, box.height);
    context.clip();
    context.translate(box.x + (box.width / 2), box.y + (box.height / 2));
    context.rotate(-28 * Math.PI / 180);
    context.font = `900 ${fontSize}px Arial, Helvetica, sans-serif`;
    context.textAlign = "left";
    context.textBaseline = "top";
    context.lineWidth = Math.max(1, Math.round(fontSize / 14));
    context.strokeStyle = "rgba(0,0,0,0.13)";
    context.fillStyle = "rgba(255,255,255,0.168)";
    for (let y = -box.height * 1.4; y < box.height * 1.4; y += stepY) {
      const rowOffset = Math.round(y / stepY) % 2 === 0 ? 0 : -(stepX / 2);
      for (let x = -box.width * 1.4 + rowOffset; x < box.width * 1.4; x += stepX) {
        context.strokeText(repeated, x, y);
        context.fillText(repeated, x, y);
      }
    }
    context.restore();

    context.save();
    context.font = `900 ${Math.max(20, Math.round(Math.min(box.width, box.height) / 24))}px Arial, Helvetica, sans-serif`;
    context.textAlign = "right";
    context.textBaseline = "bottom";
    context.lineWidth = 2;
    context.strokeStyle = "rgba(0,0,0,0.48)";
    context.fillStyle = "rgba(255,255,255,0.72)";
    const margin = Math.max(18, Math.round(Math.min(box.width, box.height) / 36));
    context.strokeText("PhotosByElie", box.x + box.width - margin, box.y + box.height - margin);
    context.fillText("PhotosByElie", box.x + box.width - margin, box.y + box.height - margin);
    context.restore();
  };

  const drawVideoTitle = (context, slide, box) => {
    const title = String(slide.title || "Untitled").trim();
    const projectTitle = String(slide.projectTitle || slide.mediaType || "").trim();
    const gradientHeight = Math.max(120, Math.round(box.height * 0.25));
    const gradient = context.createLinearGradient(0, box.y + box.height - gradientHeight, 0, box.y + box.height);
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(1, "rgba(0,0,0,0.62)");
    context.fillStyle = gradient;
    context.fillRect(box.x, box.y + box.height - gradientHeight, box.width, gradientHeight);

    const bottomPadding = Math.max(54, Math.round(Math.min(box.width, box.height) * 0.075));
    const titleSize = Math.max(30, Math.min(72, Math.round(box.width * 0.07)));
    const eyebrowSize = Math.max(15, Math.min(28, Math.round(titleSize * 0.36)));
    const titleY = box.y + box.height - bottomPadding;
    context.save();
    context.textAlign = "center";
    context.shadowColor = "rgba(0,0,0,0.82)";
    context.shadowBlur = 10;
    context.shadowOffsetY = 2;
    context.fillStyle = "rgba(255,255,255,0.84)";
    context.font = `900 ${eyebrowSize}px Arial, Helvetica, sans-serif`;
    context.fillText(fittedSlideshowText(context, projectTitle.toUpperCase(), box.width * 0.78), box.x + (box.width / 2), titleY - titleSize - 8);
    context.fillStyle = "#ffffff";
    context.font = `900 ${titleSize}px Arial, Helvetica, sans-serif`;
    context.fillText(fittedSlideshowText(context, title, box.width * 0.78), box.x + (box.width / 2), titleY);
    context.restore();
  };

  const drawVideoCounter = (context, counterText, box) => {
    const fontSize = Math.max(18, Math.round(Math.min(box.width, box.height) / 34));
    const paddingX = Math.max(7, Math.round(fontSize * 0.4));
    const paddingY = Math.max(4, Math.round(fontSize * 0.26));
    const margin = Math.max(12, Math.round(Math.min(box.width, box.height) / 42));
    context.save();
    context.font = `850 ${fontSize}px Arial, Helvetica, sans-serif`;
    context.textBaseline = "top";
    context.textAlign = "left";
    const metrics = context.measureText(counterText);
    const width = metrics.width + (paddingX * 2);
    const height = fontSize + (paddingY * 2);
    const x = box.x + margin;
    const y = box.y + box.height - margin - height;
    roundedRectPath(context, x, y, width, height, Math.max(3, Math.round(fontSize / 5)));
    context.fillStyle = "rgba(80,80,80,0.78)";
    context.fill();
    context.fillStyle = "#ffffff";
    context.fillText(counterText, x + paddingX, y + paddingY);
    context.restore();
  };

  const canvasTextLines = (context, text, maxWidth) => {
    const words = String(text || "").split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    words.forEach((word) => {
      const nextLine = line ? `${line} ${word}` : word;
      if (line && context.measureText(nextLine).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = nextLine;
      }
    });
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  };

  const slideshowPresentationTitleFor = (manifest) => {
    const projectTitle = (Array.isArray(manifest?.projects) ? manifest.projects : [])
      .map((project) => String(project?.projectTitle || "").trim())
      .find(Boolean);
    return projectTitle || String(manifest?.title || state.gallery?.title || "Property presentation").trim();
  };

  const smoothVideoProgress = (progress) => {
    const p = Math.max(0, Math.min(1, Number(progress) || 0));
    return p * p * (3 - (2 * p));
  };

  const brandedCardOpacity = (progress) => {
    const p = Math.max(0, Math.min(1, Number(progress) || 0));
    const fade = 0.2;
    return Math.max(0, Math.min(1, p / fade, (1 - p) / fade));
  };

  const drawRecordedBrandCard = (context, canvas, { title = "", outro = false, progress = 0 } = {}) => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    const background = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    background.addColorStop(0, "#050505");
    background.addColorStop(0.58, "#111111");
    background.addColorStop(1, "#1b1712");
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const opacity = brandedCardOpacity(progress);
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const eyebrowSize = Math.max(20, Math.round(Math.min(canvas.width, canvas.height) / 31));
    const titleSize = Math.max(38, Math.min(82, Math.round(canvas.width * 0.068)));
    const detailSize = Math.max(19, Math.round(Math.min(canvas.width, canvas.height) / 33));
    const lineWidth = Math.max(90, Math.round(canvas.width * 0.16));

    context.save();
    context.globalAlpha = opacity;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "rgba(255,255,255,0.72)";
    context.font = `900 ${eyebrowSize}px Arial, Helvetica, sans-serif`;
    context.fillText(
      outro ? "PHOTOS BY ELIE" : "PROPERTY PRESENTATION",
      centerX,
      centerY - titleSize * (outro ? 1.48 : 1.12)
    );

    context.fillStyle = "#d7b98b";
    context.fillRect(
      centerX - (lineWidth / 2),
      centerY - (titleSize * (outro ? 0.9 : 0.54)),
      lineWidth,
      Math.max(3, Math.round(canvas.height / 240))
    );

    context.fillStyle = "#ffffff";
    context.font = `900 ${titleSize}px Arial, Helvetica, sans-serif`;
    const mainTitle = outro ? "Photos By Elie" : (String(title || "Property presentation").trim() || "Property presentation");
    const mainTitleY = centerY - (outro ? titleSize * 0.24 : 0);
    canvasTextLines(context, mainTitle, canvas.width * 0.78).slice(0, 2).forEach((line, index) => {
      context.fillText(line, centerX, mainTitleY + (index * titleSize * 1.02));
    });

    context.fillStyle = "rgba(255,255,255,0.68)";
    context.font = `700 ${detailSize}px Arial, Helvetica, sans-serif`;
    context.fillText(outro ? "photos-by-elie.com" : "Photos By Elie", centerX, centerY + titleSize * (outro ? 0.62 : 1.55));
    if (outro) {
      drawVideoClosingQr(context, canvas, centerY + titleSize);
    }
    context.restore();
  };

  const drawRecordedCreditsFrame = (context, canvas, credits) => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#050505";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const safeCredits = Array.isArray(credits) ? credits.filter((entry) => String(entry?.text || "").trim()) : [];
    if (!safeCredits.length) return;

    const maxWidth = canvas.width * 0.78;
    const eyebrowSize = Math.max(22, Math.round(Math.min(canvas.width, canvas.height) / 34));
    const titleSize = Math.max(34, Math.round(Math.min(canvas.width, canvas.height) / 20));
    const detailSize = Math.max(20, Math.round(Math.min(canvas.width, canvas.height) / 42));
    const titleLineHeight = titleSize * 1.14;
    const detailLineHeight = detailSize * 1.32;

    context.save();
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "rgba(255,255,255,0.72)";
    context.font = `900 ${eyebrowSize}px Arial, Helvetica, sans-serif`;
    context.fillText("MUSIC CREDIT", canvas.width / 2, canvas.height * 0.28);

    let y = canvas.height * 0.42;
    safeCredits.forEach((entry) => {
      context.fillStyle = "#ffffff";
      context.font = `900 ${titleSize}px Arial, Helvetica, sans-serif`;
      canvasTextLines(context, entry.text, maxWidth).forEach((line) => {
        context.fillText(line, canvas.width / 2, y);
        y += titleLineHeight;
      });

      const detail = [entry.source, entry.license].filter(Boolean).join(" / ");
      if (detail) {
        y += detailLineHeight * 0.2;
        context.fillStyle = "rgba(255,255,255,0.64)";
        context.font = `700 ${detailSize}px Arial, Helvetica, sans-serif`;
        canvasTextLines(context, detail, maxWidth).forEach((line) => {
          context.fillText(line, canvas.width / 2, y);
          y += detailLineHeight;
        });
      }
      y += titleLineHeight * 0.45;
    });
    context.restore();
  };

  const drawRecordedSlideFrame = (context, canvas, slide, media, progress, counterText, watermarkText) => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#050505";
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.save();
    context.globalAlpha = 0.48;
    context.filter = "blur(24px)";
    drawSlideshowMedia(context, media, { x: 0, y: 0, width: canvas.width, height: canvas.height }, "cover");
    context.restore();

    const cardBox = objectFitBox(media.dimensions, { x: 0, y: 0, width: canvas.width, height: canvas.height }, "contain");
    const easedProgress = smoothVideoProgress(progress);
    const transform = kenBurnsFrameTransform(slide.effect, easedProgress, canvas);
    context.save();
    context.translate(canvas.width / 2 + transform.x, canvas.height / 2 + transform.y);
    context.scale(transform.scale, transform.scale);
    context.translate(-canvas.width / 2, -canvas.height / 2);
    context.save();
    context.beginPath();
    context.rect(cardBox.x, cardBox.y, cardBox.width, cardBox.height);
    context.clip();
    drawSlideshowMedia(context, media, cardBox, "cover");
    drawVideoWatermark(context, watermarkText, cardBox);
    drawVideoTitle(context, slide, cardBox);
    drawVideoCounter(context, counterText, cardBox);
    context.restore();
    context.restore();

    const visibleFraction = Math.max(0, Math.min(
      1,
      easedProgress / slideshowTransitionFraction,
      (1 - easedProgress) / slideshowTransitionFraction,
    ));
    if (visibleFraction < 1) {
      context.fillStyle = `rgba(5,5,5,${1 - visibleFraction})`;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
  };

  const nextAnimationFrame = () => new Promise((resolve) => window.requestAnimationFrame(resolve));

  const prepareSlideshowAudio = async (manifest, totalDurationSeconds) => {
    const audioPolicy = manifest.slideshowSettings?.audioPolicy || {};
    const musicTrack = audioPolicy.musicTrack || null;
    const musicUrl = musicTrack?.absoluteSrc || absoluteTrackUrl(musicTrack);
    if (!musicUrl) return null;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("This browser cannot add music to a recorded video.");
    const context = new AudioContextClass();
    await context.resume?.();
    if (context.state && context.state !== "running") {
      await context.close?.();
      throw new Error("Tap Download video once so this browser can add music to the video file.");
    }
    const destination = context.createMediaStreamDestination();
    const musicController = new AbortController();
    const musicTimer = window.setTimeout(() => musicController.abort(), slideshowAssetTimeoutMs);
    let musicBytes;
    try {
      const response = await fetch(musicUrl, { mode: "cors", signal: musicController.signal });
      if (!response.ok) throw new Error(`Could not load slideshow music: HTTP ${response.status}`);
      musicBytes = await response.arrayBuffer();
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("Timed out loading slideshow music.");
      throw error;
    } finally {
      window.clearTimeout(musicTimer);
    }
    const buffer = await context.decodeAudioData(musicBytes);
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    gain.connect(destination);
    return {
      stream: destination.stream,
      start: () => {
        const now = context.currentTime + 0.05;
        const duration = Math.max(0.1, totalDurationSeconds);
        const creditsDuration = slideshowCreditDurationMsFor(slideshowRequiredCreditsFor(manifest)) / 1000;
        const musicEnd = Math.max(0.1, duration - creditsDuration);
        const fadeDuration = Math.max(0.3, Math.min(duration, Number(manifest.slideshowSettings?.musicFadeOutSeconds || state.slideshowPhotoSeconds) || state.slideshowPhotoSeconds));
        const fadeStart = Math.max(0, musicEnd - fadeDuration);
        const volume = Math.max(0, Math.min(1, Math.pow(10, Number(musicTrack?.musicGainDb ?? slideshowMusicGainDb) / 20)));
        gain.gain.setValueAtTime(volume, now);
        gain.gain.setValueAtTime(volume, now + fadeStart);
        gain.gain.linearRampToValueAtTime(0.0001, now + musicEnd);
        if (duration > musicEnd + 0.01) gain.gain.setValueAtTime(0.0001, now + duration);
        source.start(now);
        source.stop(now + duration + 0.25);
      },
      stop: () => {
        try { source.stop(); } catch {}
        destination.stream.getTracks().forEach((track) => track.stop());
        context.close?.();
      },
    };
  };

  const recordSlideshowVideoAttempt = async (manifest, slides, { size = slideshowVideoSizeFor(manifest), mimeType = preferredSlideshowVideoMimeType(), signal = null } = {}, onProgress = null) => {
    throwIfVideoExportAborted(signal);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot render the slideshow video.");
    const requiredCredits = slideshowRequiredCreditsFor(manifest);
    const creditDurationMs = slideshowCreditDurationMsFor(requiredCredits);
    const introDurationMs = Math.max(1000, Number(manifest?.slideshowSettings?.presentation?.introDurationMs) || slideshowIntroDurationMs);
    const outroDurationMs = Math.max(1000, Number(manifest?.slideshowSettings?.presentation?.outroDurationMs) || slideshowOutroDurationMs);
    const totalDurationSeconds = (
      slides.reduce((sum, slide) => sum + (Math.max(1000, Number(slide.durationMs) || 0) / 1000), 0)
      + (introDurationMs / 1000)
      + (outroDurationMs / 1000)
      + (creditDurationMs / 1000)
    );
    let canvasStream = null;
    let audio = null;
    let stream = null;
    let recorder = null;
    let stopped = null;
    const chunks = [];
    let recorderError = null;
    let recorderStopTimedOut = false;

    try {
      canvasStream = canvas.captureStream(slideshowVideoFps);
      audio = await prepareSlideshowAudio(manifest, totalDurationSeconds);
      throwIfVideoExportAborted(signal);
      stream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...(audio?.stream?.getAudioTracks?.() || []),
      ]);
      recorder = new MediaRecorder(stream, { mimeType });
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data?.size) chunks.push(event.data);
      });
      recorder.addEventListener("error", (event) => {
        recorderError = event.error || new Error("The video recorder failed.");
      });
      stopped = new Promise((resolve) => recorder.addEventListener("stop", resolve, { once: true }));
      recorder.start(1000);
      audio?.start?.();
      const presentationTitle = slideshowPresentationTitleFor(manifest);
      {
        const startedAt = performance.now();
        let elapsed = 0;
        while (elapsed < introDurationMs) {
          throwIfVideoExportAborted(signal);
          elapsed = performance.now() - startedAt;
          drawRecordedBrandCard(context, canvas, {
            title: presentationTitle,
            progress: Math.max(0, Math.min(1, elapsed / introDurationMs)),
          });
          onProgress?.({ phase: "intro", index: 0, total: slides.length + 2, progress: Math.max(0, Math.min(1, elapsed / introDurationMs)) });
          await nextAnimationFrame();
        }
      }
      for (const [index, slide] of slides.entries()) {
        throwIfVideoExportAborted(signal);
        onProgress?.({ phase: "load", index, total: slides.length, slide });
        const media = await loadSlideshowMedia(slide);
        try {
          if (media.kind === "video") {
            try {
              media.element.currentTime = 0;
              await media.element.play();
            } catch {
              // Muted autoplay can still fail in some browsers; the poster frame will be recorded.
            }
          }
          const duration = Math.max(1000, Number(slide.durationMs) || 4000);
          const startedAt = performance.now();
          let elapsed = 0;
          while (elapsed < duration) {
            throwIfVideoExportAborted(signal);
            elapsed = performance.now() - startedAt;
            const progress = Math.max(0, Math.min(1, elapsed / duration));
            drawRecordedSlideFrame(context, canvas, slide, media, progress, `${index + 1}/${slides.length}`, String(manifest.slideshowSettings?.watermarkText || "").trim());
            onProgress?.({ phase: "render", index, total: slides.length, progress, slide });
            await nextAnimationFrame();
          }
        } finally {
          if (media.element?._photosByElieObjectUrl) {
            URL.revokeObjectURL(media.element._photosByElieObjectUrl);
            media.element._photosByElieObjectUrl = "";
          }
          if (media.kind === "video") {
            media.element.pause();
            media.element.removeAttribute("src");
            media.element.load();
          }
        }
      }
      {
        const startedAt = performance.now();
        let elapsed = 0;
        while (elapsed < outroDurationMs) {
          throwIfVideoExportAborted(signal);
          elapsed = performance.now() - startedAt;
          drawRecordedBrandCard(context, canvas, {
            outro: true,
            progress: Math.max(0, Math.min(1, elapsed / outroDurationMs)),
          });
          onProgress?.({ phase: "outro", index: slides.length + 1, total: slides.length + 2, progress: Math.max(0, Math.min(1, elapsed / outroDurationMs)) });
          await nextAnimationFrame();
        }
      }
      if (requiredCredits.length) {
        const duration = Math.max(1000, creditDurationMs || 3500);
        const startedAt = performance.now();
        let elapsed = 0;
        while (elapsed < duration) {
          throwIfVideoExportAborted(signal);
          elapsed = performance.now() - startedAt;
          drawRecordedCreditsFrame(context, canvas, requiredCredits);
          onProgress?.({ phase: "credits", index: slides.length, total: slides.length + 1, progress: Math.max(0, Math.min(1, elapsed / duration)) });
          await nextAnimationFrame();
        }
      }
      onProgress?.({ phase: "finalize", index: slides.length, total: slides.length, progress: 1 });
    } finally {
      if (recorder && recorder.state !== "inactive") {
        try { recorder.requestData?.(); } catch {}
        await waitForVideoExportDelay(180);
        try { recorder.stop(); } catch {}
      }
      const stopResult = await waitForRecorderStop(recorder, stopped, signal).catch((error) => {
        if (error?.name === "AbortError") throw error;
        return "error";
      });
      recorderStopTimedOut = stopResult === "timeout";
      if (stream) stream.getTracks().forEach((track) => track.stop());
      else canvasStream?.getTracks?.().forEach((track) => track.stop());
      audio?.stop?.();
    }
    throwIfVideoExportAborted(signal);
    if (recorderError) throw recorderError;
    const finalMimeType = recorder.mimeType || mimeType;
    const blob = new Blob(chunks, { type: finalMimeType });
    if (!blob.size) throw new Error("The browser created an empty video file.");
    if (recorderStopTimedOut) console.warn("Real Estate slideshow recorder stop timed out; using recorded chunks collected so far.");
    return {
      blob,
      mimeType: finalMimeType,
      extension: slideshowVideoExtensionFor(finalMimeType),
      size,
    };
  };

  const recordSlideshowVideoBlob = async (manifest, onProgress = null, { signal = null } = {}) => {
    const mimeTypes = supportedSlideshowVideoMimeTypes();
    if (!mimeTypes.length || !canRecordSlideshowVideo()) {
      throw new Error("This browser cannot record a real video file from the slideshow. Try current Safari or Chrome on desktop.");
    }
    const slides = slideshowSlidesFor(manifest);
    if (!slides.length) throw new Error("No slides are available for video export.");
    const sizes = slideshowVideoSizesFor(manifest);
    let lastError = null;
    for (const size of sizes) {
      for (const mimeType of mimeTypes) {
        try {
          onProgress?.({ phase: "attempt", size, mimeType, total: slides.length });
          return await recordSlideshowVideoAttempt(manifest, slides, { size, mimeType, signal }, onProgress);
        } catch (error) {
          if (error?.name === "AbortError") throw error;
          lastError = error;
          console.warn("Real Estate slideshow recorder attempt failed", {
            size,
            mimeType,
            message: error?.message || String(error),
          });
          onProgress?.({ phase: "retry", size, mimeType, error, total: slides.length });
        }
      }
    }
    const portrait = manifest?.slideshowSettings?.outputOrientation === "portrait";
    const detail = lastError?.message ? `: ${lastError.message}` : ".";
    throw new Error(`The browser could not finish the ${portrait ? "vertical " : ""}video file${detail}`);
  };

  const currentVideoExportKey = () => {
    const photos = activeSelectedPhotos();
    if (!photos.length) return "";
    const projects = projectGroupsFor(photos, true).map((project) => ({
      projectId: project.projectId,
      projectTitle: project.projectTitle,
      projectIndex: project.projectIndex,
      items: project.photos.map((photo) => ({
        id: photo.id,
        title: titleFor(photo),
        mediaType: mediaTypeFor(photo),
        durationSeconds: isVideo(photo) ? durationSecondsFor(photo) : state.slideshowPhotoSeconds,
        dimensions: pdfDimensionsFor(photo),
        image: imageFor(photo, "detail"),
        video: isVideo(photo) ? videoPreviewFor(photo) : "",
      })),
    }));
    return JSON.stringify({
      schema: "photosbyelie.realEstateVideoCache.v3",
      galleryKey: state.gallery?.key || "",
      photoDurationSeconds: state.slideshowPhotoSeconds,
      outputOrientation: normalizeSlideshowOrientation(state.slideshowOrientation),
      musicCountry: state.slideshowMusicCountry,
      resolvedMusicCountry: activeSlideshowMusicCountry(photos),
      musicManifestLoaded: state.slideshowMusicManifestLoaded,
      musicTrackCount: state.slideshowMusicTracks.length,
      watermarkText: activeWatermarkText(),
      musicCreditPolicy: "append-end-card-when-required-v1",
      projects,
    });
  };

  const clearVideoExportTimer = () => {
    if (!state.videoExportTimer) return;
    window.clearTimeout(state.videoExportTimer);
    state.videoExportTimer = 0;
  };

  const updateBackgroundVideoProgress = ({ detail = "", current = 0, total = 0, done = false } = {}) => {
    if (state.outputBusy || state.pdfBusy || !elements.outputProgress) return;
    if (!state.outputProgressStartedAt || current === 0) state.outputProgressStartedAt = Date.now();
    updateOutputProgress({
      title: done ? "Video ready" : "Preparing video in background",
      detail,
      current,
      total,
      done,
    });
    if (done) {
      state.outputProgressStartedAt = 0;
      if (state.outputProgressHideTimer) window.clearTimeout(state.outputProgressHideTimer);
      state.outputProgressHideTimer = window.setTimeout(() => {
        if (elements.outputProgress) elements.outputProgress.hidden = true;
        state.outputProgressHideTimer = 0;
      }, 4500);
    }
  };

  const scheduleVideoExportSynthesis = (delay = 700) => {
    clearVideoExportTimer();
    if (!isCloudRenderMode) return;
    const selected = activeSelectedPhotos();
    if (!state.unlocked || !selected.length || !canRecordSlideshowVideo()) return;
    const batch = buildSlideshowManifest(selected, true);
    if (batch.slideshowSettings?.audioPolicy?.musicTrack) return;
    state.videoExportTimer = window.setTimeout(() => {
      state.videoExportTimer = 0;
      ensureVideoExportReady({ background: true }).catch(() => {});
    }, Math.max(0, Number(delay) || 0));
  };

  const invalidateVideoExportCache = ({ schedule = true } = {}) => {
    clearVideoExportTimer();
    state.videoExportToken += 1;
    state.videoExportAbort?.abort?.();
    state.videoExportAbort = null;
    state.videoExportPromise = null;
    state.videoExportCache = null;
    state.videoExportCacheKey = "";
    state.videoExportStatus = "idle";
    state.videoExportError = "";
    syncFileActionLabels();
    if (schedule) scheduleVideoExportSynthesis();
  };

  const ensureVideoExportReady = async ({ background = false } = {}) => {
    const key = currentVideoExportKey();
    if (!key) throw new Error("Select media before preparing a video output.");
    if (state.videoExportCache?.key === key) return state.videoExportCache;
    if (state.videoExportPromise && state.videoExportCacheKey === key) return state.videoExportPromise;

    state.videoExportToken += 1;
    const token = state.videoExportToken;
    const controller = new AbortController();
    state.videoExportAbort?.abort?.();
    state.videoExportAbort = controller;
    state.videoExportCache = null;
    state.videoExportCacheKey = key;
    state.videoExportStatus = "building";
    state.videoExportError = "";
    syncFileActionLabels();

    const promise = (async () => {
      const selected = activeSelectedPhotos();
      const batch = buildSlideshowManifest(selected, true);
      const slides = slideshowSlidesFor(batch);
      if (background) {
        updateBackgroundVideoProgress({
          detail: `Recording ${slides.length} slide${slides.length === 1 ? "" : "s"} for the video file...`,
          current: 0,
          total: Math.max(1, slides.length),
        });
      }
      const recorded = await recordSlideshowVideoBlob(batch, ({ phase, index = 0, total = slides.length, slide, size }) => {
        if (phase === "attempt" && background) {
          updateBackgroundVideoProgress({
            detail: `Starting ${size?.width || ""}x${size?.height || ""} video recording...`,
            current: 0,
            total: Math.max(1, total),
          });
          return;
        }
        if (phase === "finalize") {
          const detail = "Finalizing video file...";
          if (background) updateBackgroundVideoProgress({ detail, current: Math.max(1, total), total: Math.max(1, total) });
          else {
            updateOutputProgress({ title: "Preparing video file", detail, current: 2, total: 3 });
            setStatus(detail);
          }
          return;
        }
        if (phase !== "load") return;
        const detail = `Recording slide ${index + 1}/${total}: ${slide?.title || "Untitled"}`;
        if (background) updateBackgroundVideoProgress({ detail, current: index + 1, total });
        else {
          updateOutputProgress({ title: "Preparing video file", detail, current: 2, total: 3 });
          setStatus(detail);
        }
      }, { signal: controller.signal });
      throwIfVideoExportAborted(controller.signal);
      if (token !== state.videoExportToken || currentVideoExportKey() !== key) throw videoExportAbortError();
      const filename = `${state.gallery?.key || "real-estate"}-${batch.batchId}-slideshow.${recorded.extension}`;
      const cache = {
        key,
        batch,
        blob: recorded.blob,
        mimeType: recorded.mimeType,
        extension: recorded.extension,
        filename,
        bytes: Number(recorded.blob?.size) || 0,
        size: recorded.size,
      };
      state.videoExportCache = cache;
      state.videoExportStatus = "ready";
      state.videoExportError = "";
      if (background) {
        updateBackgroundVideoProgress({
          detail: `Video ready: ${filename} (${formatBytes(cache.bytes)})`,
          current: 1,
          total: 1,
          done: true,
        });
      }
      syncFileActionLabels();
      return cache;
    })();

    state.videoExportPromise = promise;
    promise.catch((error) => {
      if (error?.name === "AbortError" || token !== state.videoExportToken) return;
      state.videoExportStatus = "error";
      state.videoExportError = error?.message || "Video output could not be prepared";
      if (background) {
        updateBackgroundVideoProgress({
          detail: state.videoExportError,
          current: 0,
          total: 1,
        });
      }
      syncFileActionLabels();
    }).finally(() => {
      if (state.videoExportPromise === promise) state.videoExportPromise = null;
      if (state.videoExportAbort === controller) state.videoExportAbort = null;
      syncFileActionLabels();
    });
    return promise;
  };

  const shareSlideshowPlan = async ({ mode = "download", reservedWindow = null, recordProduct = true, progressKind = "", batchOverride = null } = {}) => {
    if (!requireUnlocked() || state.outputBusy) return;
    const selected = activeSelectedPhotos();
    if (!selected.length && !batchOverride?.items?.length) {
      setStatus(`Select media before ${mode === "view" ? "viewing" : "downloading"} a video output`);
      return;
    }
    const cloudBatch = buildSlideshowManifest(selected, true, batchOverride);
    if (!isCloudRenderMode) {
      try {
        const queued = await queueCloudOutputs({
          batch: cloudBatch,
          formats: ["video"],
          progressKind: progressKind || (mode === "view" ? "video-view" : "video-download"),
        });
        const ready = queued?.deliverables?.find((record) => deliverableFormatCode(record.type) === "video");
        setStatus(ready?.status === "ready"
          ? t("re.status.video_ready_shelf", {}, "Video ready. Use Download video.")
          : t("re.status.video_generating_cloud", {}, "Video is generating in the cloud and will appear on the shelf when ready."));
      } catch (error) {
        const message = error?.message || "Cloud video could not be prepared.";
        setStatus(message);
        failOutputProgress(message);
      }
      return;
    }
    let cloudRecord = null;
    try {
      startOutputProgress({
        title: "Generating video",
        detail: "Rendering the slideshow in this browser...",
        total: 3,
        kind: progressKind || (mode === "view" ? "video-view" : "video-download"),
      });
      let recorded = null;
      let filename = "";
      if (!batchOverride) {
        if (state.videoExportStatus === "building") invalidateVideoExportCache({ schedule: false });
        updateOutputProgress({ title: "Generating video", detail: "Recording the selected photos...", current: 1, total: 3 });
        const prepared = await ensureVideoExportReady({ background: false });
        recorded = prepared;
        filename = prepared.filename;
      } else {
        const slides = slideshowSlidesFor(cloudBatch);
        updateOutputProgress({ title: "Generating video", detail: `Recording ${slides.length} slide${slides.length === 1 ? "" : "s"}...`, current: 1, total: 3 });
        recorded = await recordSlideshowVideoBlob(cloudBatch, ({ phase, index, total, slide }) => {
          const detail = phase === "finalize"
            ? "Finalizing video file..."
            : phase === "load"
              ? `Recording slide ${index + 1}/${total}: ${slide.title || "Untitled"}`
              : "Generating video...";
          updateOutputProgress({ title: "Generating video", detail, current: phase === "finalize" ? 2 : 1, total: 3 });
          setStatus(detail);
        });
        filename = `${state.gallery?.key || "real-estate"}-${cloudBatch.batchId}-slideshow.${recorded.extension}`;
      }
      updateOutputProgress({ title: "Generating video", detail: "Preparing the finished-products shelf entry...", current: 2, total: 3 });
      const queued = await queueCloudOutputs({
        batch: cloudBatch,
        formats: ["video"],
        progressKind: progressKind || (mode === "view" ? "video-view" : "video-download"),
      });
      cloudRecord = queued?.deliverables?.find((record) => deliverableFormatCode(record.type) === "video") || null;
      if (!cloudRecord) throw new Error("The video shelf entry could not be created.");
      updateOutputProgress({ title: "Generating video", detail: "Uploading video to the finished-products shelf...", current: 2, total: 3 });
      const saved = await completeCloudOutput({ record: cloudRecord, blob: recorded.blob, filename });
      updateOutputProgress({ title: "Generating video", detail: "Video ready on the shelf.", current: 3, total: 3 });
      setStatus(`Video ready (${formatBytes(saved.bytes || recorded.blob.size)}). Use Download video.`);
      completeOutputProgress(`Video ready: ${saved.filename || filename} (${formatBytes(saved.bytes || recorded.blob.size)})`);
    } catch (error) {
      if (cloudRecord) await failCloudOutput(cloudRecord, error);
      if (error?.name !== "AbortError") console.error("Real Estate video output failed", error);
      const message = error?.name === "AbortError"
        ? "Video output canceled"
        : error?.message
          ? `Video output could not be prepared: ${error.message}`
          : "Video output could not be prepared";
      setStatus(message);
      failOutputProgress(message);
    }
  };

  let crcTable = null;
  const crc32Table = () => {
    if (crcTable) return crcTable;
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      crcTable[n] = c >>> 0;
    }
    return crcTable;
  };

  const crc32 = (bytes) => {
    const table = crc32Table();
    let crc = 0xffffffff;
    for (let index = 0; index < bytes.length; index += 1) {
      crc = table[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };

  const dosDateTime = (date = new Date()) => {
    const year = Math.max(1980, date.getFullYear());
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    };
  };

  const assertZip32 = (value) => {
    if (value > 0xffffffff) {
      throw new Error("This ZIP is too large for the browser path. Split the selection into smaller batches.");
    }
    return value >>> 0;
  };

  const localZipHeader = (entry) => {
    const header = new Uint8Array(30 + entry.nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, entry.time, true);
    view.setUint16(12, entry.date, true);
    view.setUint32(14, entry.crc, true);
    view.setUint32(18, assertZip32(entry.size), true);
    view.setUint32(22, assertZip32(entry.size), true);
    view.setUint16(26, entry.nameBytes.length, true);
    view.setUint16(28, 0, true);
    header.set(entry.nameBytes, 30);
    return header;
  };

  const centralZipHeader = (entry) => {
    const header = new Uint8Array(46 + entry.nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0x0800, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, entry.time, true);
    view.setUint16(14, entry.date, true);
    view.setUint32(16, entry.crc, true);
    view.setUint32(20, assertZip32(entry.size), true);
    view.setUint32(24, assertZip32(entry.size), true);
    view.setUint16(28, entry.nameBytes.length, true);
    view.setUint16(30, 0, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    view.setUint32(38, 0, true);
    view.setUint32(42, assertZip32(entry.offset), true);
    header.set(entry.nameBytes, 46);
    return header;
  };

  const endOfCentralZipDirectory = ({ fileCount, centralSize, centralOffset }) => {
    if (fileCount > 0xffff) throw new Error("Too many files for this ZIP.");
    const header = new Uint8Array(22);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, fileCount, true);
    view.setUint16(10, fileCount, true);
    view.setUint32(12, assertZip32(centralSize), true);
    view.setUint32(16, assertZip32(centralOffset), true);
    return header;
  };

  const uniqueZipEntryName = (baseName, usedNames) => {
    const clean = String(baseName || "original.jpg")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 150) || "original.jpg";
    const normalized = clean.toLowerCase();
    if (!usedNames.has(normalized)) {
      usedNames.add(normalized);
      return clean;
    }
    const match = clean.match(/^(.*?)(\.[^.]+)?$/);
    const stem = match?.[1] || clean;
    const extension = match?.[2] || "";
    let counter = 2;
    while (usedNames.has(`${stem}-${counter}${extension}`.toLowerCase())) counter += 1;
    const next = `${stem}-${counter}${extension}`;
    usedNames.add(next.toLowerCase());
    return next;
  };

  const buildStoredZipBlob = async (files, onProgress) => {
    const encoder = new TextEncoder();
    const parts = [];
    const centralEntries = [];
    const { time, date } = dosDateTime();
    let offset = 0;

    for (const [index, file] of files.entries()) {
      onProgress?.({ index, file, phase: "fetch" });
      const response = await fetch(file.url);
      if (!response.ok) throw new Error(`Could not fetch ${file.name || file.entryName}`);
      const blob = await response.blob();
      onProgress?.({ index, file, phase: "zip" });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const nameBytes = encoder.encode(file.entryName || file.name);
      if (nameBytes.byteLength > 0xffff) throw new Error(`Filename is too long for ZIP: ${file.entryName || file.name}`);
      const entry = {
        nameBytes,
        crc: crc32(bytes),
        size: blob.size,
        offset,
        time,
        date,
      };
      const header = localZipHeader(entry);
      assertZip32(offset + header.byteLength + blob.size);
      parts.push(header, blob);
      offset += header.byteLength + blob.size;
      centralEntries.push(entry);
      onProgress?.({ index, file, phase: "done" });
    }

    const centralOffset = offset;
    centralEntries.forEach((entry) => {
      const header = centralZipHeader(entry);
      parts.push(header);
      offset += header.byteLength;
    });
    parts.push(endOfCentralZipDirectory({
      fileCount: centralEntries.length,
      centralSize: offset - centralOffset,
      centralOffset,
    }));
    return new Blob(parts, { type: "application/zip" });
  };

  const originalRequestItemsFor = (photos) => photos.map((photo, index) => ({
    photoId: photo.id,
    albumSlug: photo.albumSlug,
    sourceFile: photo.full || "",
    mediaType: mediaTypeFor(photo),
    title: titleFor(photo),
    sortIndex: index + 1,
  }));

  const credentialsForOriginals = async (message = "") => {
    const saved = readSessionCredentials();
    const username = state.username || saved.username || state.payload?.customer?.username || state.payload?.customer?.name || "";
    writeSessionCredentials(username);
    return { username };
  };

  const requestOriginalsSession = async (photos, passwordMessage = "") => {
    const baseUrl = workerBaseUrl();
    if (!baseUrl) throw new Error("Originals ZIP needs the Photos By Elie Worker.");
    const credentials = await credentialsForOriginals(passwordMessage);
    const response = await fetch(`${baseUrl}/real-estate/originals/session`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        galleryKey: state.gallery?.key || "",
        username: credentials.username,
        items: originalRequestItemsFor(photos),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = body?.error?.message || "Originals ZIP could not be prepared.";
      const error = new Error(message);
      error.status = response.status;
      error.code = body?.error?.code || "originals_session_failed";
      throw error;
    }
    return body.originals;
  };

  const originalZipFilesFor = (session) => {
    const baseUrl = workerBaseUrl();
    const usedNames = new Set();
    return (session.files || []).map((file) => ({
      ...file,
      url: `${baseUrl}${file.downloadUrl}`,
      entryName: uniqueZipEntryName(file.name || `${file.photoId || "real-estate-original"}.jpg`, usedNames),
    }));
  };

  const shareOriginalsZip = async () => {
    if (!requireUnlocked() || state.originalsBusy || state.outputBusy) return;
    const photos = selectedPhotos();
    if (!photos.length) {
      setStatus("Select media before preparing originals ZIP");
      return;
    }
    state.originalsBusy = true;
    startOutputProgress({
      title: "Preparing originals ZIP",
      detail: "Requesting private original links...",
      kind: "originals",
    });
    syncFileActionLabels();
    try {
      setStatus(`Preparing private original links for ${photos.length} selected media item${photos.length === 1 ? "" : "s"}...`);
      updateOutputProgress({
        title: "Preparing originals ZIP",
        detail: `Requesting private links for ${photos.length} selected media item${photos.length === 1 ? "" : "s"}...`,
      });
      const session = await requestOriginalsSession(photos);
      if (!session) throw new Error("Originals ZIP could not be prepared.");
      const files = originalZipFilesFor(session);
      const totalBytes = Number(session.totalBytes) || files.reduce((sum, file) => sum + (Number(file.bytes) || 0), 0);
      const totalSteps = Math.max(2, (files.length * 3) + 2);
      let currentStep = 1;
      updateOutputProgress({
        title: "Preparing originals ZIP",
        detail: `Building ZIP from ${files.length} file${files.length === 1 ? "" : "s"}${totalBytes ? ` (${formatBytes(totalBytes)})` : ""}...`,
        current: currentStep,
        total: totalSteps,
      });
      setStatus(`Building originals ZIP from ${files.length} file${files.length === 1 ? "" : "s"}${totalBytes ? ` (${formatBytes(totalBytes)})` : ""}...`);
      const blob = await buildStoredZipBlob(files, ({ index, file, phase }) => {
        const number = index + 1;
        if (phase === "fetch") {
          currentStep += 1;
          const detail = `Fetching original ${number}/${files.length}: ${file.name}`;
          setStatus(detail);
          updateOutputProgress({ title: "Preparing originals ZIP", detail, current: currentStep, total: totalSteps });
        }
        if (phase === "zip") {
          currentStep += 1;
          const detail = `Adding original ${number}/${files.length} to ZIP: ${file.name}`;
          setStatus(detail);
          updateOutputProgress({ title: "Preparing originals ZIP", detail, current: currentStep, total: totalSteps });
        }
        if (phase === "done") {
          currentStep += 1;
          updateOutputProgress({
            title: "Preparing originals ZIP",
            detail: `Finished original ${number}/${files.length}: ${file.name}`,
            current: currentStep,
            total: totalSteps,
          });
        }
      });
      const filename = session.zipFilename || `${state.gallery?.key || "real-estate"}-originals-${timestampId()}.zip`;
      updateOutputProgress({
        title: "Preparing originals ZIP",
        detail: "Sending ZIP to your device...",
        current: totalSteps - 1,
        total: totalSteps,
      });
      const saved = await shareOrOpenBlob({
        blob,
        filename,
        title: "Photos By Elie originals",
        text: `${state.payload?.customer?.name || "Client"} selected original media`,
        openFallback: false,
      });
      if (saved.method === "share" || saved.method === "share-opened") {
        setStatus(`Shared ${saved.filename} (${formatBytes(saved.bytes)})`);
      } else {
        setStatus(`Downloaded ${saved.filename} to Downloads (${formatBytes(saved.bytes)})`);
      }
      completeOutputProgress(`Ready: ${saved.filename} (${formatBytes(saved.bytes)})`);
    } catch (error) {
      const message = error?.name === "AbortError" ? "Originals ZIP canceled" : (error?.message || "Originals ZIP failed");
      if (!handleAuthFailure(error)) {
        setStatus(message);
        failOutputProgress(message);
      }
    } finally {
      state.originalsBusy = false;
      syncFileActionLabels();
    }
  };

  const pdfDimensionsFor = (photo) => {
    const dimensions = photo?.cloudPdfSource?.dimensions
      || photo?.media?.publicPreview?.detailDimensions
      || photo?.media?.publicPreview?.dimensions
      || {};
    const width = Number(dimensions.width) || 1800;
    const height = Number(dimensions.height) || 1200;
    return { width, height };
  };

  const pdfPhotoFor = (entry) => entry?.photo || entry;
  const pdfTitleFor = (entry) => entry?.title || titleFor(pdfPhotoFor(entry));

  const pdfImageKeysFor = (photo) => {
    const preview = photo?.media?.publicPreview || {};
    return [
      preview.detailKey,
      photo?.cloudPdfSource?.publicKey,
      preview.galleryKey,
    ].map((key) => String(key || "").replace(/^\/+/, ""))
      .filter(Boolean)
      .filter((key, index, keys) => keys.indexOf(key) === index);
  };

  const pdfImageUrlsFor = (photo) => {
    const directUrl = imageFor(photo, "detail");
    const keys = pdfImageKeysFor(photo);
    const workerUrls = keys.map(workerMediaUrl).filter(Boolean);
    const publicUrls = keys.map(publicMediaUrl).filter(Boolean);
    const candidates = isLocalHost
      ? [directUrl, ...workerUrls, ...publicUrls]
      : [...workerUrls, directUrl, ...publicUrls];
    return candidates.filter(Boolean).filter((url, index, urls) => urls.indexOf(url) === index);
  };

  const fetchPdfImageBlob = async (photo, title, index, total) => {
    const urls = pdfImageUrlsFor(photo);
    let lastError = urls.length ? "" : "no image URL is configured";
    for (const url of urls) {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          lastError = `HTTP ${response.status}`;
          continue;
        }
        const blob = await response.blob();
        if (!blob || !blob.size) {
          lastError = "empty image response";
          continue;
        }
        return blob;
      } catch (error) {
        lastError = error?.message || "network request failed";
      }
    }
    const label = title || titleFor(photo) || `image ${index + 1}`;
    throw new Error(`Could not load PDF image ${index + 1}/${total}: ${label}${lastError ? ` (${lastError})` : ""}`);
  };

  const fetchPdfImages = async (photos, onProgress = null) => {
    const images = [];
    for (const [index, entry] of photos.entries()) {
      const photo = pdfPhotoFor(entry);
      const title = pdfTitleFor(entry);
      const blob = await fetchPdfImageBlob(photo, title, index, photos.length);
      images.push({
        blob,
        dimensions: pdfDimensionsFor(photo),
        photo,
        title,
      });
      onProgress?.({ index, total: photos.length, photo, title });
    }
    return images;
  };

  const isLandscapePdfImage = (item) => item.dimensions.width >= item.dimensions.height;

  const paginatePdfImages = (images) => {
    const pages = [];
    let pendingLandscape = null;
    images.forEach((item) => {
      if (isLandscapePdfImage(item)) {
        if (pendingLandscape) {
          pages.push({ layout: "two-up-landscape", items: [pendingLandscape, item] });
          pendingLandscape = null;
        } else {
          pendingLandscape = item;
        }
        return;
      }
      if (pendingLandscape) {
        pages.push({ layout: "single-landscape", items: [pendingLandscape] });
        pendingLandscape = null;
      }
      pages.push({ layout: "single-portrait", items: [item] });
    });
    if (pendingLandscape) pages.push({ layout: "single-landscape", items: [pendingLandscape] });
    return pages;
  };

  const imagePlacement = (dimensions, box, { verticalAlign = "middle" } = {}) => {
    const scale = Math.min(box.width / dimensions.width, box.height / dimensions.height);
    const width = dimensions.width * scale;
    const height = dimensions.height * scale;
    return {
      width,
      height,
      x: box.x + ((box.width - width) / 2),
      y: verticalAlign === "top" ? box.y : box.y + ((box.height - height) / 2),
    };
  };

  const loadPdfImage = (blob) => new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(blob);
    const cleanup = () => URL.revokeObjectURL(objectUrl);
    image.onload = () => resolve({ image, cleanup });
    image.onerror = () => {
      cleanup();
      reject(new Error("Could not decode a PDF image"));
    };
    image.src = objectUrl;
  });

  const canvasToJpegBytes = (canvas, quality = 0.86) => new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error("Could not render PDF page"));
        return;
      }
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, "image/jpeg", quality);
  });

  const fittedCanvasText = (context, value, maxWidth) => {
    const text = String(value || "");
    if (context.measureText(text).width <= maxWidth) return text;
    const ellipsis = "...";
    let low = 0;
    let high = text.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (context.measureText(`${text.slice(0, mid)}${ellipsis}`).width <= maxWidth) low = mid;
      else high = mid - 1;
    }
    return `${text.slice(0, low)}${ellipsis}`;
  };

  const drawCenteredCanvasText = (context, text, x, y, width) => {
    context.fillText(text, x + (width / 2), y);
  };

  const drawImporterStyleCanvasWatermark = (context, text, box) => {
    const watermarkText = String(text || "").trim();
    if (!watermarkText || !box?.width || !box?.height) return;
    const fontSize = Math.max(18, Math.round(Math.max(box.width, box.height) / 45));
    const repeatFontSize = Math.max(34, Math.round(fontSize * 2.35));
    const repeatStroke = Math.max(2, Math.round(Math.max(1, fontSize / 14) * 2.2));
    const repeatText = watermarkText.toUpperCase();

    context.save();
    context.beginPath();
    context.rect(box.x, box.y, box.width, box.height);
    context.clip();
    context.font = `900 ${repeatFontSize}px Arial, Helvetica, sans-serif`;
    context.textAlign = "left";
    context.textBaseline = "top";
    const metrics = context.measureText(repeatText);
    const textWidth = Math.max(1, metrics.width);
    const textHeight = repeatFontSize;
    const tilePadding = Math.max(80, Math.round(Math.min(box.width, box.height) * 0.22));
    const stepX = Math.max(220, Math.round((textWidth + tilePadding * 2) * 0.78));
    const stepY = Math.max(180, Math.round((textHeight + tilePadding * 2) * 0.72));

    context.translate(box.x + (box.width / 2), box.y + (box.height / 2));
    context.rotate(-28 * Math.PI / 180);
    context.translate(-(box.width / 2), -(box.height / 2));
    context.lineWidth = repeatStroke;
    context.strokeStyle = "rgba(0, 0, 0, 0.13)";
    context.fillStyle = "rgba(255, 255, 255, 0.168)";
    for (let y = -box.height; y < box.height * 2; y += stepY) {
      const rowOffset = Math.round(y / stepY) % 2 === 0 ? 0 : -(stepX / 2);
      for (let x = -box.width + rowOffset; x < box.width * 2; x += stepX) {
        context.strokeText(repeatText, x, y);
        context.fillText(repeatText, x, y);
      }
    }
    context.restore();

    context.save();
    context.beginPath();
    context.rect(box.x, box.y, box.width, box.height);
    context.clip();
    const cornerFontSize = Math.max(18, Math.round(Math.min(box.width, box.height) / 24));
    const cornerStroke = Math.max(1, Math.round(Math.min(box.width, box.height) / 360));
    const cornerMargin = Math.max(18, Math.round(Math.min(box.width, box.height) / 36));
    context.font = `900 ${cornerFontSize}px Arial, Helvetica, sans-serif`;
    context.textAlign = "right";
    context.textBaseline = "bottom";
    context.lineWidth = cornerStroke;
    context.strokeStyle = "rgba(0, 0, 0, 0.48)";
    context.fillStyle = "rgba(255, 255, 255, 0.72)";
    context.strokeText("PhotosByElie", box.x + box.width - cornerMargin, box.y + box.height - cornerMargin);
    context.fillText("PhotosByElie", box.x + box.width - cornerMargin, box.y + box.height - cornerMargin);
    context.restore();
  };

  const PDF_FOOTER_QR_URL = "https://photos-by-elie.com/";
  const PDF_FOOTER_BRAND = "Photos By Elie";
  const PDF_FOOTER_QR_SIZE_PT = 10 * 72 / 25.4;
  const PDF_FOOTER_QR_QUIET_MODULES = 4;
  const VIDEO_CLOSING_QR_SIZE_PX = 25 * 96 / 25.4;
  const PDF_FOOTER_QR_MATRIX = [
    "1111111000101100001111111",
    "1000001010100011101000001",
    "1011101000001011001011101",
    "1011101011101110101011101",
    "1011101001000000101011101",
    "1000001011011011001000001",
    "1111111010101010101111111",
    "0000000001110010000000000",
    "1111101111011111010101010",
    "0011000000101100100100010",
    "1000111110100011100001011",
    "1100000000010001101000001",
    "1001101111111110011110111",
    "1010000010011100000101010",
    "1010111011000001110111011",
    "1000010111100010010110001",
    "1001101101011111111110100",
    "0000000011110000100011000",
    "1111111010100010101010111",
    "1000001000110010100011010",
    "1011101011011101111110100",
    "1011101011010100111011111",
    "1011101011000110110001101",
    "1000001011111001111111001",
    "1111111010101110001111111",
  ];

  const drawVideoClosingQr = (context, canvas, topY) => {
    const qrSize = VIDEO_CLOSING_QR_SIZE_PX;
    const matrixSize = PDF_FOOTER_QR_MATRIX.length;
    const totalModules = matrixSize + (PDF_FOOTER_QR_QUIET_MODULES * 2);
    const moduleSize = qrSize / totalModules;
    const qrX = (canvas.width - qrSize) / 2;

    context.save();
    context.imageSmoothingEnabled = false;
    context.fillStyle = "#ffffff";
    context.fillRect(qrX, topY, qrSize, qrSize);
    context.fillStyle = "#000000";
    PDF_FOOTER_QR_MATRIX.forEach((row, rowIndex) => {
      [...row].forEach((module, columnIndex) => {
        if (module !== "1") return;
        const x = qrX + ((PDF_FOOTER_QR_QUIET_MODULES + columnIndex) * moduleSize);
        const y = topY + ((PDF_FOOTER_QR_QUIET_MODULES + rowIndex) * moduleSize);
        context.fillRect(x, y, moduleSize + 0.15, moduleSize + 0.15);
      });
    });
    context.restore();
  };

  const pdfLiteralText = (value) => String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");

  const pdfFooterCommandsFor = ({ pageIndex, pageCount, pageWidth }) => {
    const qrSize = PDF_FOOTER_QR_SIZE_PT;
    const qrX = pageWidth - 30 - qrSize;
    const qrY = 14;
    const matrixSize = PDF_FOOTER_QR_MATRIX.length;
    const totalModules = matrixSize + (PDF_FOOTER_QR_QUIET_MODULES * 2);
    const moduleSize = qrSize / totalModules;
    const brandX = qrX - 60;
    const textY = qrY + (qrSize / 2) - 3;
    const commands = [
      "q",
      "1 1 1 rg",
      `${qrX.toFixed(3)} ${qrY.toFixed(3)} ${qrSize.toFixed(3)} ${qrSize.toFixed(3)} re f`,
      "0 0 0 rg",
    ];
    PDF_FOOTER_QR_MATRIX.forEach((row, rowIndex) => {
      [...row].forEach((module, columnIndex) => {
        if (module !== "1") return;
        const x = qrX + ((PDF_FOOTER_QR_QUIET_MODULES + columnIndex) * moduleSize);
        const y = qrY + qrSize - ((PDF_FOOTER_QR_QUIET_MODULES + rowIndex + 1) * moduleSize);
        commands.push(`${x.toFixed(3)} ${y.toFixed(3)} ${moduleSize.toFixed(3)} ${moduleSize.toFixed(3)} re f`);
      });
    });
    commands.push(
      "Q",
      `BT /F1 8 Tf 30 ${textY.toFixed(3)} Td (${pdfLiteralText(`Page ${pageIndex + 1} / ${pageCount}`)}) Tj ET`,
      `BT /F1 8 Tf ${brandX.toFixed(3)} ${textY.toFixed(3)} Td (${pdfLiteralText(PDF_FOOTER_BRAND)}) Tj ET`,
      `% QR ${PDF_FOOTER_QR_URL}`
    );
    return `${commands.join("\n")}\n`;
  };

  const renderPdfPages = async (images, onProgress = null) => {
    const pages = paginatePdfImages(images);
    const paper = paperFormatFor();
    const pageWidth = paper.width;
    const pageHeight = paper.height;
    const watermarkText = activeWatermarkText();
    const margin = 30;
    const captionArea = 30;
    const captionGap = 7;
    const footerArea = 40;
    const rowGap = 18;
    const scale = 2;
    const renderedPages = [];

    for (const [pageIndex, page] of pages.entries()) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(pageWidth * scale);
      canvas.height = Math.round(pageHeight * scale);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not render PDF page");
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, pageWidth, pageHeight);

      const contentHeight = pageHeight - (margin * 2) - footerArea;
      const slotHeight = page.layout === "two-up-landscape"
        ? ((contentHeight - rowGap) / 2)
        : contentHeight;
      const slots = page.layout === "two-up-landscape"
        ? [
          { x: margin, y: margin, width: pageWidth - (margin * 2), height: slotHeight },
          { x: margin, y: margin + slotHeight + rowGap, width: pageWidth - (margin * 2), height: slotHeight },
        ]
        : [{ x: margin, y: margin, width: pageWidth - (margin * 2), height: slotHeight }];

      for (const [index, item] of page.items.entries()) {
        const slot = slots[index];
        const loaded = await loadPdfImage(item.blob);
        try {
          const naturalDimensions = {
            width: loaded.image.naturalWidth || item.dimensions.width,
            height: loaded.image.naturalHeight || item.dimensions.height,
          };
          const imageBox = {
            x: slot.x,
            y: slot.y,
            width: slot.width,
            height: Math.max(1, slot.height - captionArea),
          };
          const placement = imagePlacement(naturalDimensions, imageBox, { verticalAlign: "top" });
          context.drawImage(loaded.image, placement.x, placement.y, placement.width, placement.height);
          if (watermarkText) drawImporterStyleCanvasWatermark(context, watermarkText, placement);

          context.fillStyle = "#111111";
          context.font = "700 12px Arial, Helvetica, sans-serif";
          context.textAlign = "center";
          context.textBaseline = "top";
          drawCenteredCanvasText(
            context,
            fittedCanvasText(context, item.title || titleFor(item.photo), slot.width),
            slot.x,
            placement.y + placement.height + captionGap,
            slot.width
          );

          if (watermarkText) {
            const watermarkFontSize = Math.max(8, Math.min(12, placement.width / 48));
            context.font = `700 ${watermarkFontSize}px Arial, Helvetica, sans-serif`;
            context.textAlign = "center";
            context.textBaseline = "alphabetic";
            const photoWatermark = fittedCanvasText(context, watermarkText, placement.width - 18);
            const watermarkY = placement.y + placement.height - Math.max(8, watermarkFontSize * 0.8);
            context.fillStyle = "rgba(0, 0, 0, 0.38)";
            drawCenteredCanvasText(context, photoWatermark, placement.x + 1, watermarkY + 1, placement.width);
            context.fillStyle = "rgba(255, 255, 255, 0.70)";
            drawCenteredCanvasText(context, photoWatermark, placement.x, watermarkY, placement.width);
          }
        } finally {
          loaded.cleanup();
        }
      }

      renderedPages.push({
        bytes: await canvasToJpegBytes(canvas),
        width: canvas.width,
        height: canvas.height,
      });
      onProgress?.({ pageIndex, total: pages.length, page });
    }

    return {
      pages: renderedPages,
      pageWidth,
      pageHeight,
    };
  };

  const bytesToBase64 = (bytes) => {
    const parts = [];
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      parts.push(String.fromCharCode(...bytes.subarray(index, index + chunkSize)));
    }
    return btoa(parts.join(""));
  };

  const pdfPreviewHtmlFor = ({ projectTitle = "", filename = "", rendered = null } = {}) => {
    const pages = Array.isArray(rendered?.pages) ? rendered.pages : [];
    const dateLabel = new Date().toLocaleString();
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${escapeHtml(projectTitle || "PDF preview")}</title>
  <style>
    :root{color-scheme:light;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#e8eaed;color:#111}
    body{margin:0;background:#e8eaed;color:#111}
    header{position:sticky;top:0;z-index:2;background:rgba(255,255,255,.96);border-bottom:1px solid rgba(0,0,0,.14);padding:12px 14px;box-shadow:0 8px 20px rgba(0,0,0,.08)}
    h1{margin:0;font-size:clamp(1.1rem,5vw,1.6rem);line-height:1.1}
    p{margin:4px 0 0;color:#444;font-size:.9rem;font-weight:650}
    main{display:grid;gap:14px;width:min(100%,980px);margin:0 auto;padding:14px 10px 28px}
    figure{margin:0;display:grid;gap:6px}
    figcaption{color:#555;font-size:.78rem;font-weight:750;text-align:center}
    img{display:block;width:100%;height:auto;background:#fff;box-shadow:0 8px 24px rgba(0,0,0,.22)}
    .empty{background:#fff;border:1px solid rgba(0,0,0,.14);padding:20px;text-align:center}
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(projectTitle || "PDF preview")}</h1>
    <p>${escapeHtml(filename)}${filename ? " / " : ""}${pages.length} page${pages.length === 1 ? "" : "s"} / ${escapeHtml(dateLabel)}</p>
  </header>
  <main>
    ${pages.length ? pages.map((page, index) => `
    <figure>
      <img alt="PDF page ${index + 1}" src="data:image/jpeg;base64,${bytesToBase64(page.bytes)}"/>
      <figcaption>Page ${index + 1} of ${pages.length}</figcaption>
    </figure>`).join("") : '<div class="empty">No preview pages were rendered.</div>'}
  </main>
</body>
</html>`;
  };

  const buildPdfBlobFromRendered = (rendered) => {
    const encoder = new TextEncoder();
    const objects = [];
    const setObject = (id, parts) => {
      objects[id] = parts;
      return id;
    };
    const toBytes = (part) => part instanceof Uint8Array ? part : encoder.encode(String(part));
    const pageIds = [];
    const footerFontId = 3;
    let nextId = 4;
    const { pageWidth, pageHeight } = rendered;

    setObject(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
    setObject(footerFontId, ["<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"]);

    rendered.pages.forEach((page, index) => {
      const imageId = nextId++;
      const imageName = `Pg${index + 1}`;
      setObject(imageId, [
        `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.byteLength} >>\nstream\n`,
        page.bytes,
        "\nendstream",
      ]);
      const contentId = nextId++;
      const pageId = nextId++;
      const content = [
        `q\n${pageWidth.toFixed(2)} 0 0 ${pageHeight.toFixed(2)} 0 0 cm\n/${imageName} Do\nQ\n`,
        pdfFooterCommandsFor({ pageIndex: index, pageCount: rendered.pages.length, pageWidth }),
      ].join("");
      setObject(contentId, [
        `<< /Length ${encoder.encode(content).byteLength} >>\nstream\n`,
        content,
        "endstream",
      ]);
      setObject(pageId, [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}] /Resources << /XObject << /${imageName} ${imageId} 0 R >> /Font << /F1 ${footerFontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
      ]);
      pageIds.push(pageId);
    });

    setObject(2, [`<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`]);
    const objectCount = nextId - 1;

    const chunks = [];
    const offsets = [];
    let position = 0;
    const push = (part) => {
      const bytes = toBytes(part);
      chunks.push(bytes);
      position += bytes.byteLength;
    };

    push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
    for (let id = 1; id <= objectCount; id += 1) {
      offsets[id] = position;
      push(`${id} 0 obj\n`);
      (objects[id] || ["<<>>"]).forEach(push);
      push("\nendobj\n");
    }
    const xrefStart = position;
    push(`xref\n0 ${objectCount + 1}\n`);
    push("0000000000 65535 f \n");
    for (let id = 1; id <= objectCount; id += 1) {
      push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
    }
    push(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);
    return new Blob(chunks, { type: "application/pdf" });
  };

  const buildPdfBlob = async (images, onPageRendered = null) => {
    const rendered = await renderPdfPages(images, onPageRendered);
    return buildPdfBlobFromRendered(rendered);
  };

  const setCloudRenderStatus = (status, detail = "") => {
    document.documentElement.dataset.cloudRenderStatus = String(status || "");
    document.documentElement.dataset.cloudRenderDetail = String(detail || "").slice(0, 500);
    if (elements.status) elements.status.textContent = detail || status;
  };

  const cloudRenderSyntheticPhoto = (item = {}) => {
    const dimensions = item.dimensions || { width: 1800, height: 1200 };
    return {
      id: item.photoId,
      title: item.title || item.photoId,
      mediaType: item.mediaType || "photo",
      durationSeconds: item.durationSeconds || item.sourceDurationSeconds || 0,
      cloudPdfSource: {
        publicKey: item.publicStillKey || item.publicDetailKey || (item.mediaType === "video" ? "" : item.cloudSourceKey) || "",
        sourceVideoPrivateKey: item.sourceVideoPrivateKey || "",
        dimensions,
        videoStillPercent: item.pdfStillPercent || 10,
      },
      realEstate: {
        privateMasterKey: item.sourceVideoPrivateKey || "",
        videoDurationSeconds: item.durationSeconds || item.sourceDurationSeconds || 0,
      },
      media: {
        type: item.mediaType || "photo",
        publicPreview: {
          detailKey: item.publicDetailKey || item.publicStillKey || "",
          galleryKey: item.publicGalleryKey || item.publicStillKey || "",
          detailVideoKey: item.publicVideoKey || "",
          detailDimensions: dimensions,
        },
        video: {
          durationSeconds: item.durationSeconds || item.sourceDurationSeconds || 0,
          publicPreviewKey: item.publicVideoKey || "",
        },
      },
    };
  };

  const installCloudRenderBatch = (batch) => {
    const rows = [
      ...(Array.isArray(batch?.items) ? batch.items : []),
      ...(Array.isArray(batch?.projects) ? batch.projects.flatMap((project) => Array.isArray(project?.items) ? project.items : []) : []),
    ].filter((item) => item?.photoId);
    const uniqueRows = [...new Map(rows.map((item) => [item.photoId, item])).values()];
    const existing = new Map(state.photos.map((photo) => [photo.id, photo]));
    const photos = uniqueRows.map((item) => existing.get(item.photoId) || cloudRenderSyntheticPhoto(item));
    state.photos = photos;
    state.photosById = new Map(photos.map((photo) => [photo.id, photo]));
    state.pdfFormat = paperFormatFor(batch?.pdfSettings?.paperFormat || state.pdfFormat).key;
    state.pdfOrientation = normalizePdfOrientation(batch?.pdfSettings?.pageOrientation || state.pdfOrientation);
    state.slideshowOrientation = normalizeSlideshowOrientation(batch?.slideshowSettings?.orientation || state.slideshowOrientation);
    state.slideshowPhotoSeconds = [3, 4, 5].includes(Number(batch?.slideshowSettings?.photoDurationSeconds))
      ? Number(batch.slideshowSettings.photoDurationSeconds)
      : state.slideshowPhotoSeconds;
    state.slideshowMusicCountry = normalizeSlideshowMusicCountry(batch?.slideshowSettings?.musicCountry || state.slideshowMusicCountry);
    state.watermarkEnabled = Boolean(batch?.pdfSettings?.watermarkEnabled ?? batch?.slideshowSettings?.watermarkEnabled ?? state.watermarkEnabled);
    state.watermarkText = String(batch?.pdfSettings?.photoWatermark || batch?.slideshowSettings?.watermarkText || state.watermarkText || "");
  };

  const cloudRenderEndpoint = (jobId, deliverableId = "", action = "") => {
    const baseUrl = workerBaseUrl();
    const path = deliverableId
      ? `/real-estate/internal/render-jobs/${encodeURIComponent(jobId)}/deliverables/${encodeURIComponent(deliverableId)}/${action}`
      : `/real-estate/internal/render-jobs/${encodeURIComponent(jobId)}${action ? `/${action}` : ""}`;
    const url = new URL(path, `${baseUrl}/`);
    url.searchParams.set("galleryKey", state.gallery?.key || "");
    url.searchParams.set("token", cloudRenderToken);
    return url;
  };

  let cloudRenderProgressLastAt = 0;
  let cloudRenderProgressLastPercent = -1;
  let cloudRenderProgressTail = Promise.resolve();
  const postCloudRenderProgress = ({ phase, percent, current = 0, total = 0, detail = "" } = {}, { force = false } = {}) => {
    const normalizedPercent = Math.max(0, Math.min(99, Math.round(Number(percent) || 0)));
    const timestamp = Date.now();
    if (!force && normalizedPercent === cloudRenderProgressLastPercent && timestamp - cloudRenderProgressLastAt < 1200) {
      return cloudRenderProgressTail;
    }
    if (!force && normalizedPercent < cloudRenderProgressLastPercent + 2 && timestamp - cloudRenderProgressLastAt < 1200) {
      return cloudRenderProgressTail;
    }
    cloudRenderProgressLastAt = timestamp;
    cloudRenderProgressLastPercent = normalizedPercent;
    const payload = { phase, percent: normalizedPercent, current, total, detail };
    cloudRenderProgressTail = cloudRenderProgressTail.catch(() => {}).then(async () => {
      const response = await fetch(cloudRenderEndpoint(cloudRenderJobId, "", "progress"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(`Cloud progress update failed: HTTP ${response.status}`);
    });
    return cloudRenderProgressTail;
  };

  const renderCloudPdfOutput = async (batch, reportProgress = () => {}) => {
    const projects = pdfProjectsForBatch(batch);
    const combined = { pages: [], pageWidth: paperFormatFor().width, pageHeight: paperFormatFor().height };
    const totalPhotos = projects.reduce((sum, project) => sum + project.photos.length, 0);
    let loadedPhotos = 0;
    let renderedProjects = 0;
    for (const project of projects) {
      const images = await fetchPdfImages(project.photos, () => {
        loadedPhotos += 1;
        reportProgress("pdf-loading", 0.05 + (0.40 * (loadedPhotos / Math.max(1, totalPhotos))), loadedPhotos, totalPhotos);
      });
      const rendered = await renderPdfPages(images, ({ pageIndex = 0, total = 1 } = {}) => {
        const projectProgress = (renderedProjects + ((pageIndex + 1) / Math.max(1, total))) / Math.max(1, projects.length);
        reportProgress("pdf-rendering", 0.45 + (0.43 * projectProgress), pageIndex + 1, total);
      });
      combined.pages.push(...rendered.pages);
      renderedProjects += 1;
    }
    const filename = projects.length === 1
      ? `${state.gallery?.key || "real-estate"}-${fileSlug(projects[0]?.projectTitle)}-${paperFormatFor().key}-${batch.batchId}.pdf`
      : `${state.gallery?.key || "real-estate"}-${batch.batchId}-project-pdfs.pdf`;
    return { blob: buildPdfBlobFromRendered(combined), filename, contentType: "application/pdf" };
  };

  const renderCloudVideoOutput = async (batch, reportProgress = () => {}) => {
    const recorded = await recordSlideshowVideoBlob(batch, ({ phase, index = 0, total = 1, progress = 0 } = {}) => {
      let fraction = 0.02;
      if (phase === "intro") fraction = 0.02 + (0.06 * progress);
      else if (phase === "load") fraction = 0.08 + (0.78 * (index / Math.max(1, total)));
      else if (phase === "render") fraction = 0.08 + (0.78 * ((index + progress) / Math.max(1, total)));
      else if (phase === "outro") fraction = 0.87 + (0.05 * progress);
      else if (phase === "credits") fraction = 0.92 + (0.05 * progress);
      else if (phase === "finalize") fraction = 0.98;
      reportProgress("video-rendering", fraction, Math.min(total, index + (progress >= 1 ? 1 : 0)), total);
    });
    return {
      blob: recorded.blob,
      filename: `${state.gallery?.key || "real-estate"}-${batch.batchId}-slideshow.${recorded.extension}`,
      contentType: recorded.mimeType,
    };
  };

  const postCloudRenderFailure = async (record, error) => {
    try {
      await fetch(cloudRenderEndpoint(cloudRenderJobId, record.id, "fail"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ failureReason: error?.message || String(error || "Cloud render failed.") }),
      });
    } catch {
      // The Workflow records any remaining failure if this best-effort update cannot be sent.
    }
  };

  const runCloudRenderJob = async () => {
    setCloudRenderStatus("processing", "Loading the private cloud render job...");
    const response = await fetch(cloudRenderEndpoint(cloudRenderJobId), { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw realEstateWorkerError(response, body);
    const job = body.job || {};
    const batch = job.inputManifest || job.deliverables?.[0]?.batch;
    if (!batch?.batchId) throw new Error("Cloud render job is missing its selection manifest.");
    installCloudRenderBatch(batch);
    const pending = (job.deliverables || []).filter((record) => String(record.status || "").toLowerCase() !== "ready");
    await postCloudRenderProgress({ phase: "loading", percent: 4, current: 0, total: pending.length }, { force: true });
    for (const [recordIndex, record] of pending.entries()) {
      const recordBase = 5 + ((recordIndex / Math.max(1, pending.length)) * 90);
      const recordSpan = 90 / Math.max(1, pending.length);
      const reportRecordProgress = (phase, fraction, current = 0, total = 0) => postCloudRenderProgress({
        phase,
        percent: recordBase + (Math.max(0, Math.min(1, fraction)) * recordSpan),
        current,
        total,
      });
      setCloudRenderStatus("processing", `Rendering ${record.type === "pdf" ? "PDF" : "video"} in the cloud...`);
      try {
        const output = record.type === "pdf"
          ? await renderCloudPdfOutput(batch, reportRecordProgress)
          : await renderCloudVideoOutput(batch, reportRecordProgress);
        await reportRecordProgress(record.type === "video" ? "video-transcoding" : "pdf-uploading", 0.98, 1, 1);
        const completeUrl = cloudRenderEndpoint(cloudRenderJobId, record.id, "complete");
        completeUrl.searchParams.set("filename", output.filename);
        const completeResponse = await fetch(completeUrl, {
          method: "POST",
          headers: { "content-type": output.contentType },
          body: output.blob,
        });
        const completeBody = await completeResponse.json().catch(() => ({}));
        if (!completeResponse.ok) throw realEstateWorkerError(completeResponse, completeBody);
        await reportRecordProgress("finalizing", 1, recordIndex + 1, pending.length);
      } catch (error) {
        await postCloudRenderFailure(record, error);
        throw error;
      }
    }
    await postCloudRenderProgress({ phase: "complete", percent: 99, current: pending.length, total: pending.length }, { force: true });
    await cloudRenderProgressTail.catch(() => {});
    setCloudRenderStatus("ready", `${pending.length || job.deliverables?.length || 0} cloud output${(pending.length || job.deliverables?.length || 0) === 1 ? "" : "s"} ready.`);
  };

  const pdfProjectsForBatch = (batch) => {
    const sourceProjects = Array.isArray(batch?.projects) && batch.projects.length
      ? batch.projects
      : [{
        projectId: activeProjectId(),
        projectTitle: selectedPropertyTitle(),
        sortIndex: 1,
        items: Array.isArray(batch?.items) ? batch.items : [],
      }];
    return sourceProjects.map((project, index) => ({
      projectId: project.projectId || `project-${index + 1}`,
      projectTitle: project.projectTitle || `Project ${index + 1}`,
      projectIndex: Number(project.sortIndex) || index + 1,
      photos: (Array.isArray(project.items) ? project.items : [])
        .map((item) => {
          const photo = state.photosById.get(item?.photoId);
          return photo ? { photo, title: item?.title || titleFor(photo) } : null;
        })
        .filter(Boolean),
    })).filter((project) => project.photos.length);
  };

  const downloadPdf = async ({
    mode = "download",
    reservedWindows = [],
    recordProduct = true,
    progressKind = "",
    batchOverride = null,
    projectsOverride = null,
  } = {}) => {
    if (!requireUnlocked() || state.pdfBusy || state.outputBusy) return;
    const photos = batchOverride ? [] : activeSelectedPhotos();
    const batch = batchOverride || buildBatchManifest(photos, true);
    const projects = Array.isArray(projectsOverride) ? projectsOverride : pdfProjectsForBatch(batch);
    const selectedCount = projects.reduce((sum, project) => sum + project.photos.length, 0);
    if (!selectedCount) {
      setStatus("Select media before preparing a PDF");
      return;
    }
    if (!isCloudRenderMode) {
      try {
        const queued = await queueCloudOutputs({
          batch,
          formats: ["pdf"],
          progressKind: progressKind || (mode === "view" ? "pdf-view" : "pdf-download"),
        });
        const ready = queued?.deliverables?.find((record) => deliverableFormatCode(record.type) === "pdf");
        setStatus(ready?.status === "ready"
          ? t("re.status.pdf_ready_shelf", {}, "PDF ready. Use Download PDF.")
          : t("re.status.pdf_generating_cloud", {}, "PDF is generating in the cloud and will appear on the shelf when ready."));
      } catch (error) {
        const message = error?.message || "Cloud PDF could not be prepared.";
        setStatus(message);
        failOutputProgress(message);
      }
      return;
    }
    let cloudRecord = null;
    try {
      const queued = await queueCloudOutputs({
        batch,
        formats: ["pdf"],
        progressKind: progressKind || (mode === "view" ? "pdf-view" : "pdf-download"),
      });
      cloudRecord = queued?.deliverables?.find((record) => deliverableFormatCode(record.type) === "pdf") || null;
      if (!cloudRecord) throw new Error("The PDF shelf entry could not be created.");
      const paper = paperFormatFor();
      const filename = projects.length === 1
        ? `${state.gallery?.key || "real-estate"}-${fileSlug(projects[0]?.projectTitle)}-${paper.key}-${batch.batchId}.pdf`
        : `${state.gallery?.key || "real-estate"}-${batch.batchId}-project-pdfs.pdf`;
      const plannedPages = projects.reduce((sum, project) => (
        sum + paginatePdfImages(project.photos.map((entry) => ({
          dimensions: pdfDimensionsFor(pdfPhotoFor(entry)),
          photo: pdfPhotoFor(entry),
        }))).length
      ), 0);
      const totalSteps = Math.max(1, selectedCount + plannedPages + 1);
      let progressStep = 0;
      const updatePdfStep = (detail) => {
        progressStep += 1;
        updateOutputProgress({ title: "Preparing PDF", detail, current: progressStep, total: totalSteps });
        setStatus(detail);
      };
      state.pdfBusy = true;
      startOutputProgress({
        title: "Preparing PDF",
        detail: `Building ${paper.label} PDF from ${selectedCount} selected media...`,
        total: totalSteps,
        kind: progressKind || (mode === "view" ? "pdf-view" : "pdf-download"),
      });
      const combined = { pages: [], pageWidth: paper.width, pageHeight: paper.height };
      for (const project of projects) {
        const images = await fetchPdfImages(project.photos, ({ index, total, photo, title }) => {
          updatePdfStep(`Loaded image ${index + 1}/${total} for ${project.projectTitle}: ${title || titleFor(photo)}`);
        });
        const rendered = await renderPdfPages(images, ({ pageIndex, total }) => {
          updatePdfStep(`Rendered PDF page ${pageIndex + 1}/${total} for ${project.projectTitle}`);
        });
        combined.pages.push(...rendered.pages);
      }
      const blob = buildPdfBlobFromRendered(combined);
      updateOutputProgress({ title: "Preparing PDF", detail: "Uploading PDF to the finished-products shelf...", current: totalSteps, total: totalSteps });
      const saved = await completeCloudOutput({ record: cloudRecord, blob, filename });
      setStatus(`PDF ready (${formatBytes(saved.bytes || blob.size)}). Use Download PDF.`);
      completeOutputProgress(`PDF ready: ${saved.filename || filename} (${formatBytes(saved.bytes || blob.size)})`);
    } catch (error) {
      if (cloudRecord) await failCloudOutput(cloudRecord, error);
      const message = error?.name === "AbortError" ? "PDF output canceled" : (error?.message || "PDF output failed");
      setStatus(message);
      failOutputProgress(message);
    } finally {
      state.pdfBusy = false;
      syncFileActionLabels();
    }
  };

  const downloadPdfLegacy = async ({
    mode = "download",
    reservedWindows = [],
    recordProduct = true,
    progressKind = "",
    batchOverride = null,
    projectsOverride = null,
  } = {}) => {
    if (!requireUnlocked() || state.pdfBusy || state.outputBusy) return;
    const photos = batchOverride ? [] : activeSelectedPhotos();
    const batch = batchOverride || buildBatchManifest(photos, true);
    const projects = Array.isArray(projectsOverride) ? projectsOverride : pdfProjectsForBatch(batch);
    const selectedCount = projects.reduce((sum, project) => sum + project.photos.length, 0);
    if (!selectedCount) {
      setStatus(`Select media before ${mode === "view" ? "viewing" : "downloading"} project PDFs`);
      return;
    }
    await queueCloudOutputs({
      batch,
      formats: ["pdf"],
      progressKind: progressKind || (mode === "view" ? "pdf-view" : "pdf-download"),
    });
    return;
    const outputWindows = mode === "view" ? [...reservedWindows] : [];
    while (mode === "view" && outputWindows.length < projects.length) outputWindows.push(reserveOutputWindow("Building PDF"));
    const batchId = batch.batchId;
    const paper = paperFormatFor();
    const shelfFilename = projects.length === 1
      ? `${state.gallery?.key || "real-estate"}-${fileSlug(projects[0]?.projectTitle)}-${paper.key}-${batchId}.pdf`
      : `${state.gallery?.key || "real-estate"}-${batchId}-project-pdfs.pdf`;
    const summary = batchOverride?.mediaSummary || selectedMediaSummary(photos);
    const videoNote = summary.videos ? `; ${summary.videos} video${summary.videos === 1 ? "" : "s"} will use 10% stills` : "";
    const plannedPages = projects.reduce((sum, project) => (
      sum + paginatePdfImages(project.photos.map((entry) => {
        const photo = pdfPhotoFor(entry);
        return { dimensions: pdfDimensionsFor(photo), photo };
      })).length
    ), 0);
    const totalSteps = Math.max(1, selectedCount + plannedPages + projects.length);
    const progressTitle = mode === "view" ? "Preparing PDF preview" : "Preparing PDF download";
    let progressStep = 0;
    const updatePdfStep = (detail) => {
      progressStep += 1;
      updateOutputProgress({
        title: progressTitle,
        detail,
        current: progressStep,
        total: totalSteps,
      });
      setStatus(detail);
    };
    state.pdfBusy = true;
    startOutputProgress({
      title: progressTitle,
      detail: `Building ${projects.length} ${paper.label} project PDF${projects.length === 1 ? "" : "s"} from ${selectedCount} selected media${videoNote}...`,
      total: totalSteps,
      kind: progressKind || (mode === "view" ? "pdf-view" : "pdf-download"),
    });
    if (recordProduct) saveSelectionBeforeOutput(batch);
    if (recordProduct) saveLocalDeliverable({ type: "pdf", batch, filename: shelfFilename });
    let savedProjectCount = 0;
    let totalSavedBytes = 0;
    let lastFilename = "";
    try {
      for (const [index, project] of projects.entries()) {
        const images = await fetchPdfImages(project.photos, ({ index: imageIndex, total, photo, title }) => {
          updatePdfStep(`Loaded image ${imageIndex + 1}/${total} for ${project.projectTitle}: ${title || titleFor(photo)}`);
        });
        const rendered = await renderPdfPages(images, ({ pageIndex, total }) => {
          updatePdfStep(`Rendered PDF page ${pageIndex + 1}/${total} for ${project.projectTitle}`);
        });
        const blob = buildPdfBlobFromRendered(rendered);
        const filename = `${state.gallery?.key || "real-estate"}-${fileSlug(project.projectTitle)}-${paper.key}-${batchId}.pdf`;
        const previewFilename = filename.replace(/\.pdf$/i, "-preview.html");
        const previewHtml = mode === "view"
          ? pdfPreviewHtmlFor({ projectTitle: project.projectTitle, filename, rendered })
          : "";
        const saved = mode === "view"
          ? await openHtmlInBrowser(previewHtml, previewFilename, outputWindows[index] || null)
          : { method: "download", ...(await downloadBlob(blob, filename)) };
        savedProjectCount += 1;
        totalSavedBytes += Number(blob.size) || Number(saved.bytes) || 0;
        lastFilename = filename;
        const displayFilename = mode === "view" ? filename : (saved.filename || filename);
        updatePdfStep(`${saved.method === "open" || saved.method === "open-current" ? "Opened preview for" : "Downloaded"} ${displayFilename}`);
        if (saved.method === "open" || saved.method === "open-current") {
          setStatus(`Viewing ${displayFilename}. ${deliverableActionNote}`);
        } else {
          setStatus(`Downloaded ${saved.filename} to Downloads (${formatBytes(saved.bytes)})`);
        }
      }
      if (recordProduct) {
        saveLocalDeliverable({
          type: "pdf",
          batch,
          filename: projects.length === 1 ? lastFilename : shelfFilename,
          bytes: totalSavedBytes,
        });
      }
      setStatus(`${mode === "view" ? "Viewing" : "Downloaded"} ${projects.length} ${paper.label} project PDF${projects.length === 1 ? "" : "s"} with ${selectedCount} media${videoNote}. ${deliverableActionNote}`);
      completeOutputProgress(`${mode === "view" ? "Viewing" : "Downloaded"} ${projects.length} ${paper.label} project PDF${projects.length === 1 ? "" : "s"} (${formatBytes(totalSavedBytes)})`);
    } catch (error) {
      let message = "";
      if (error?.name === "AbortError") {
        message = savedProjectCount
          ? `PDF output canceled after ${savedProjectCount} project PDF${savedProjectCount === 1 ? "" : "s"}`
          : "PDF output canceled";
      } else {
        message = error?.message || "PDF output failed";
      }
      if (mode === "view") outputWindows.forEach((popup) => showOutputWindowError(popup, "PDF needs attention", message));
      setStatus(message);
      failOutputProgress(message);
    } finally {
      state.pdfBusy = false;
      syncFileActionLabels();
    }
  };

  const outputSelectedOutputs = async (mode = "view") => {
    if (!requireUnlocked()) return;
    const selected = activeSelectedPhotos();
    if (!selected.length) {
      setStatus(`Select at least one photo or video before ${mode === "view" ? "viewing" : "downloading"} outputs`);
      return;
    }
    const batch = buildBatchManifest(selected, true);
    const progressKind = mode === "view" ? "outputs-view" : "outputs-download";
    const videoBatch = buildSlideshowManifest(selected, true, batch);
    await queueCloudOutputs({
      batch: {
        ...batch,
        slideshowSettings: videoBatch.slideshowSettings,
        projects: (batch.projects || []).map((project) => {
          const videoProject = (videoBatch.projects || []).find((candidate) => candidate.projectId === project.projectId);
          const videoItems = new Map((videoProject?.items || []).map((item) => [item.photoId, item]));
          return {
            ...project,
            items: (project.items || []).map((item) => ({ ...item, ...(videoItems.get(item.photoId) || {}) })),
          };
        }),
        items: (batch.items || []).map((item) => ({
          ...item,
          ...((videoBatch.items || []).find((candidate) => candidate.photoId === item.photoId) || {}),
        })),
      },
      formats: ["pdf", "video"],
      progressKind,
    });
  };

  const openSelectedOutputs = () => outputSelectedOutputs("view");
  const downloadSelectedOutputs = () => outputSelectedOutputs("download");

  const selectVisible = () => {
    if (!requireUnlocked()) return;
    const visible = filteredPhotos().map((photo) => photo.id);
    applySelectionForPhotoIds(visible, true);
  };

  const clearSelection = () => {
    if (!requireUnlocked()) return;
    applySelectionForPhotoIds(activeSelectedPhotos().map((photo) => photo.id), false);
  };

  const returnToShelf = () => {
    if (!requireUnlocked()) return;
    flushTitleInputs();
    state.detailMode = false;
    state.activeDeliverableId = "";
    state.activeDeliverableName = "";
    state.activeDeliverableNameEdited = false;
    state.editingDeliverableNameId = "";
    state.selectedOnly = false;
    if (elements.selectedOnly) elements.selectedOnly.checked = false;
    render();
    elements.deliverablesPanel?.scrollIntoView({ behavior: "smooth", block: "start" });
    setStatus(t("re.status.back_shelf", {}, "Back to the saved selection shelf."));
  };

  const startNewProduct = () => {
    if (!requireUnlocked()) return;
    state.detailMode = true;
    state.activeDeliverableId = "";
    state.album = defaultAlbumSlug();
    state.shootFilters = state.album ? [state.album] : [];
    state.activeDeliverableName = nextGeneratedDeliverableName("selection", new Date().toISOString(), "", selectedPropertyTitle());
    state.activeDeliverableNameEdited = false;
    state.editingDeliverableNameId = "";
    state.selectedOrder = [];
    state.selectedIds = new Set();
    state.projectAssignments = {};
    state.selectedOnly = false;
    persistSelection();
    persistProjectAssignments();
    invalidateVideoExportCache({ schedule: false });
    setWizardStep(firstWizardStep());
    document.querySelector("#real-estate-wizard")?.scrollIntoView({ behavior: "smooth", block: "start" });
    setStatus("Started a new selection. Choose media, edit titles, reorder, then view or download outputs.");
  };

  const activeSelectionIds = () => activeSelectedPhotos().map((photo) => photo.id);

  const reorderActiveSelection = (nextActiveIds) => {
    const activeSet = new Set(nextActiveIds);
    const queue = [...nextActiveIds];
    state.selectedOrder = state.selectedOrder.map((id) => (
      activeSet.has(id) ? queue.shift() : id
    ));
    queue.forEach((id) => {
      if (!state.selectedOrder.includes(id)) state.selectedOrder.push(id);
    });
    persistSelection();
    invalidateVideoExportCache();
    render();
  };

  const moveDraftItem = (photoId, direction) => {
    const activeIds = activeSelectionIds();
    const index = activeIds.indexOf(photoId);
    const nextIndex = index + Number(direction);
    if (index < 0 || nextIndex < 0 || nextIndex >= activeIds.length) return;
    const next = [...activeIds];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    reorderActiveSelection(next);
    setStatus(`Moved ${titleFor(state.photosById.get(photoId))} to position ${nextIndex + 1}`);
  };

  const clearDraftDropHints = () => {
    document.querySelectorAll(".real-estate-draft-item.is-drop-before, .real-estate-draft-item.is-drop-after").forEach((item) => {
      item.classList.remove("is-drop-before", "is-drop-after");
    });
  };

  const draftDropPosition = (event, item) => {
    const rect = item.getBoundingClientRect();
    return event.clientY > rect.top + (rect.height / 2) ? "after" : "before";
  };

  const draftDropTarget = (event) => {
    if (!state.dragDraftId) return null;
    const node = document.elementFromPoint(event.clientX, event.clientY);
    const directItem = node?.closest?.("[data-draft-photo]");
    if (directItem && directItem.dataset.draftPhoto !== state.dragDraftId) {
      return {
        item: directItem,
        position: draftDropPosition(event, directItem),
      };
    }

    const items = [...(elements.draftList?.querySelectorAll("[data-draft-photo]") || [])]
      .filter((item) => item.dataset.draftPhoto !== state.dragDraftId);
    if (!items.length) return null;
    const beforeItem = items.find((item) => {
      const rect = item.getBoundingClientRect();
      return event.clientY < rect.top + (rect.height / 2);
    });
    if (beforeItem) return { item: beforeItem, position: "before" };
    return { item: items[items.length - 1], position: "after" };
  };

  const showDraftDropHint = (event) => {
    const target = draftDropTarget(event);
    clearDraftDropHints();
    if (!target) return null;
    target.item.classList.add(target.position === "after" ? "is-drop-after" : "is-drop-before");
    return target;
  };

  const draftElementFor = (photoId) => (
    [...(elements.draftList?.querySelectorAll("[data-draft-photo]") || [])]
      .find((item) => item.dataset.draftPhoto === photoId)
  );

  const resetPointerDraftDrag = () => {
    draftElementFor(state.pointerDraftId)?.classList.remove("is-dragging");
    state.pointerDraftId = "";
    state.pointerDraftStartX = 0;
    state.pointerDraftStartY = 0;
    state.pointerDraftActive = false;
    state.dragDraftId = "";
    clearDraftDropHints();
  };

  const moveDraftItemTo = (photoId, targetPhotoId, position) => {
    if (!photoId || !targetPhotoId || photoId === targetPhotoId) return;
    if (!state.selectedIds.has(photoId) || !state.selectedIds.has(targetPhotoId)) return;
    const next = activeSelectionIds().filter((id) => id !== photoId);
    const targetIndex = next.indexOf(targetPhotoId);
    if (targetIndex < 0) return;
    next.splice(position === "after" ? targetIndex + 1 : targetIndex, 0, photoId);
    reorderActiveSelection(next);
    setStatus(`Moved ${titleFor(state.photosById.get(photoId))} to position ${next.indexOf(photoId) + 1}`);
  };

  const dialogPhotos = () => filteredPhotos();

  const showPhoto = (photoId) => {
    const photo = state.photosById.get(photoId);
    if (!photo || !elements.dialog) return;
    state.activePhotoId = photoId;
    const imageUrl = imageFor(photo, "detail");
    const videoUrl = isVideo(photo) ? videoPreviewFor(photo) : "";
    if (elements.dialogFigure) {
      elements.dialogFigure.innerHTML = videoUrl
        ? `<video controls playsinline poster="${escapeHtml(imageUrl)}" src="${escapeHtml(videoUrl)}"></video>`
        : `<img data-re-dialog-image src="${escapeHtml(imageUrl)}" alt="${escapeHtml(titleFor(photo))}"/>`;
    } else if (elements.dialogImage) {
      elements.dialogImage.src = imageUrl;
      elements.dialogImage.alt = titleFor(photo);
    }
    if (elements.dialogAlbum) elements.dialogAlbum.textContent = albumTitleFor(photo);
    if (elements.dialogTitle) elements.dialogTitle.textContent = titleFor(photo);
    if (elements.dialogTitleInput) elements.dialogTitleInput.value = titleFor(photo);
    if (elements.dialogSelected) elements.dialogSelected.checked = state.selectedIds.has(photoId);
    if (elements.dialogDetails) {
      const duration = durationSecondsFor(photo);
      const mediaDetails = [
        { label: "Media", value: isVideo(photo) ? `Video${duration ? ` / ${formatDuration(duration)}` : ""}` : "Photo" },
        ...(isVideo(photo) ? [{ label: "PDF still", value: `${videoStillPercentFor(photo)}% into video` }] : []),
      ];
      elements.dialogDetails.innerHTML = [...mediaDetails, ...(photo.metadata || [])].map((item) => `
        <div>
          <dt>${escapeHtml(item.label)}</dt>
          <dd>${escapeHtml(item.value)}</dd>
        </div>
      `).join("");
    }
    openDialog(elements.dialog);
  };

  const stepDialog = (direction) => {
    const photos = dialogPhotos();
    const index = photos.findIndex((photo) => photo.id === state.activePhotoId);
    if (index < 0 || !photos.length) return;
    const next = photos[(index + direction + photos.length) % photos.length];
    showPhoto(next.id);
  };

  const parseBatchFileText = (text) => {
    const raw = String(text || "").trim();
    if (!raw) throw new Error("Selection file is empty.");
    if (raw.startsWith("{")) return JSON.parse(raw);
    const doc = new DOMParser().parseFromString(raw, "text/html");
    const embedded = doc.querySelector("[data-re-selection-batch]");
    if (!embedded?.textContent) throw new Error("Selection table is missing its embedded data.");
    return JSON.parse(embedded.textContent);
  };

  const loadBatchFile = async (file) => {
    if (!file) return;
    const text = await file.text();
    const batch = parseBatchFileText(text);
    applyBatchManifest(batch);
  };

  const applyBatchManifest = (batch, { statusPrefix = "Loaded", editMode = false } = {}) => {
    if (batch?.pdfSettings?.paperFormat) {
      state.pdfFormat = paperFormatFor(batch.pdfSettings.paperFormat).key;
      localStorage.setItem(pdfFormatKey, state.pdfFormat);
    }
    if (batch?.pdfSettings?.pageOrientation) {
      state.pdfOrientation = normalizePdfOrientation(batch.pdfSettings.pageOrientation);
      localStorage.setItem(pdfOrientationKey, state.pdfOrientation);
    }
    if (batch?.slideshowSettings?.photoDurationSeconds) {
      state.slideshowPhotoSeconds = [3, 4, 5].includes(Number(batch.slideshowSettings.photoDurationSeconds))
        ? Number(batch.slideshowSettings.photoDurationSeconds)
        : 4;
      localStorage.setItem(slideshowPhotoSecondsKey, String(state.slideshowPhotoSeconds));
    }
    if (batch?.slideshowSettings?.orientation) {
      state.slideshowOrientation = normalizeSlideshowOrientation(batch.slideshowSettings.orientation);
      localStorage.setItem(slideshowOrientationKey, state.slideshowOrientation);
    }
    const projectItems = Array.isArray(batch.projects)
      ? batch.projects.flatMap((project) => (Array.isArray(project.items) ? project.items : [])
        .map((item) => ({
          ...item,
          projectId: project.projectId || item.projectId,
          projectTitle: project.projectTitle || item.projectTitle,
          projectSortIndex: Number(project.sortIndex) || 0,
        })))
      : [];
    const sourceItems = projectItems.length ? projectItems : (Array.isArray(batch.items) ? batch.items : []);
    const items = [...sourceItems].sort((a, b) => (
      Number(a.projectSortIndex) - Number(b.projectSortIndex)
      || Number(a.sortIndex) - Number(b.sortIndex)
    ));
    const selectedOrder = [];
    const projectAssignments = {};
    items.forEach((item) => {
      if (!item.photoId || !state.photosById.has(item.photoId)) return;
      if (!selectedOrder.includes(item.photoId)) selectedOrder.push(item.photoId);
      const itemProjectIds = Array.isArray(item.projectIds) ? item.projectIds : (item.projectId ? [item.projectId] : []);
      itemProjectIds.forEach((projectId) => {
        projectAssignments[item.photoId] = projectAssignments[item.photoId] || [];
        if (!projectAssignments[item.photoId].includes(projectId)) projectAssignments[item.photoId].push(projectId);
      });
      if (typeof item.title === "string") state.editedTitles[item.photoId] = item.title;
    });
    state.selectedOrder = selectedOrder;
    state.projectAssignments = {
      ...state.projectAssignments,
      ...projectAssignments,
    };
    const firstProjectId = items.find((item) => item.projectId && state.albums.some((album) => album.slug === item.projectId))?.projectId;
    if (firstProjectId) state.album = firstProjectId;
    const batchProjectIds = [...new Set(items.map((item) => item.projectId).filter((projectId) => state.albums.some((album) => album.slug === projectId)))];
    state.shootFilters = normalizeShootFilters(batchProjectIds.length ? batchProjectIds : [state.album]);
    persistSelection();
    persistTitles();
    persistProjectAssignments();
    invalidateVideoExportCache();
    if (editMode) state.wizardStep = 4;
    render();
    setStatus(`${statusPrefix} ${activeSelectedPhotos().length} selected media for ${selectedPropertyTitle()}${editMode ? "; output is ready to view or adjust" : ""}`);
  };

  const deliverableBatchFor = async (item) => {
    if (item?.batch) return item.batch;
    const response = await fetch(item.editUrl);
    if (!response.ok) throw new Error(`Could not load product manifest (${response.status})`);
    return parseBatchFileText(await response.text());
  };

  const editProducedDeliverable = async (deliverableId) => {
    if (!requireUnlocked()) return;
    const items = producedDeliverables();
    const generatedNames = generatedDeliverableNamesFor(items);
    const item = items.find((deliverable) => deliverable.id === deliverableId);
    if (!item) return;
    try {
      setStatus(`Loading ${displayDeliverableTitleFor(item, generatedNames)} for editing...`);
      state.detailMode = true;
      state.activeDeliverableId = item.id;
      state.activeDeliverableName = displayDeliverableTitleFor(item, generatedNames);
      state.activeDeliverableNameEdited = !needsGeneratedDeliverableName(item);
      state.editingDeliverableNameId = "";
      const batch = await deliverableBatchFor(item);
      applyBatchManifest(batch, { statusPrefix: "Editing", editMode: true });
      document.querySelector("#real-estate-wizard")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      setStatus(error?.message || "Could not load this product for editing");
    }
  };

  const runProducedDeliverable = async (deliverableId, mode = "view") => {
    if (!requireUnlocked() || state.outputBusy) return;
    const item = producedDeliverables().find((deliverable) => deliverable.id === deliverableId);
    if (!item) return;
    try {
      const outputRecords = (Array.isArray(item.records) ? item.records : [item])
        .filter((record) => record.type === "pdf" || record.type === "video")
        .filter((record) => record.status === "ready" && (mode === "view" ? record.viewUrl || record.downloadUrl : record.downloadUrl || record.viewUrl));
      if (outputRecords.length) {
        for (const record of outputRecords) {
          await openDeliverableUrl(mode === "view" ? (record.viewUrl || record.downloadUrl) : (record.downloadUrl || record.viewUrl), mode);
        }
        setStatus(`${mode === "view" ? "Opened" : "Started download for"} ${outputRecords.length} ready cloud output${outputRecords.length === 1 ? "" : "s"}.`);
        return;
      }
      if (item.status === "pending") {
        await fetchCloudDeliverables({ quiet: true }).catch(() => []);
        setStatus("Cloud output is still pending. The shelf will show Ready when PDF/video files are assembled.");
        return;
      }
      if (item.status === "needs-attention") {
        setStatus(item.failureReason || "Cloud output needs attention before it can be opened.");
        return;
      }
      const batch = await deliverableBatchFor(item);
      if (item.type === "pdf") {
        const projects = pdfProjectsForBatch(batch);
        await downloadPdf({
          mode,
          recordProduct: false,
          progressKind: mode === "view" ? "pdf-view" : "pdf-download",
          batchOverride: batch,
          projectsOverride: projects,
        });
        return;
      }
      if (item.type === "selection") {
        const title = mode === "view" ? "Opening selection view" : "Preparing selection download";
        startOutputProgress({
          title,
          detail: "Loading saved selection...",
          total: 2,
          kind: "selection",
        });
        const html = selectionHtmlFor(batch);
        const filename = `${state.gallery?.key || "real-estate"}-${batch.batchId || timestampId()}-selection.html`;
        updateOutputProgress({
          title,
          detail: mode === "view" ? "Opening saved selection view..." : "Sending saved selection file to Downloads...",
          current: 1,
          total: 2,
        });
        const blob = new Blob([html], { type: "text/html" });
        const saved = mode === "view"
          ? await openHtmlInBrowser(html, filename, reserveOutputWindow("Opening selection"))
          : { method: "download", ...(await downloadBlob(blob, filename)) };
        if (saved.method === "open" || saved.method === "open-current") {
          setStatus(`Viewing ${saved.filename}.`);
        } else {
          setStatus(`Downloaded ${saved.filename} to Downloads (${formatBytes(saved.bytes)})`);
        }
        completeOutputProgress(`Ready: ${saved.filename} (${formatBytes(saved.bytes)})`);
        return;
      }
      await shareSlideshowPlan({
        mode,
        recordProduct: false,
        progressKind: mode === "view" ? "video-view" : "video-download",
        batchOverride: batch,
      });
    } catch (error) {
      setStatus(error?.message || "Could not prepare this product");
      failOutputProgress(error?.message || "Could not prepare this product");
    }
  };

  const openBatchFile = async () => {
    if (!requireUnlocked()) return;
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({
          multiple: false,
          types: [{
            description: "Photos By Elie selection file",
            accept: {
              "text/html": [".html", ".htm"],
              "application/json": [".json"],
            },
          }],
        });
        if (handle) await loadBatchFile(await handle.getFile());
      } catch (error) {
        setStatus(error?.name === "AbortError" ? "Open canceled" : "Selection file could not be loaded");
      }
      return;
    }
    const input = document.querySelector("[data-re-load-batch-input]");
    if (input) input.click();
  };

  const bindEvents = () => {
    renderLoginCodeIcon();

    elements.loginCodeToggle?.addEventListener("click", () => {
      if (!elements.loginCode) return;
      elements.loginCode.type = elements.loginCode.type === "password" ? "text" : "password";
      renderLoginCodeIcon();
      elements.loginCode.focus();
    });

    elements.loginGoogle?.addEventListener("click", () => {
      try {
        redirectToAccessLogin();
      } catch (error) {
        if (elements.loginStatus) elements.loginStatus.textContent = error?.message || "Google login is unavailable.";
      }
    });

    elements.loginForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const enteredUser = normalizeCredential(elements.loginName?.value);
      const enteredCode = normalizeCredential(elements.loginCode?.value);
      try {
        await loginWithWorker(elements.loginName?.value || "", elements.loginCode?.value || "");
      } catch (error) {
        if (elements.loginStatus) elements.loginStatus.textContent = error?.message || "Username/email or password is incorrect.";
        return;
      }
      state.unlocked = true;
      if (elements.loginCode) elements.loginCode.value = "";
      writeSessionCredentials(elements.loginName?.value || "");
      writeSession(elements.loginName?.value || "");
      clearLogoutFromHistory();
      syncAuthUi();
      setStatus(`${state.photos.length} visible / ${state.photos.length} media`);
      fetchCloudDeliverables({ quiet: true }).catch(() => {});
      scheduleVideoExportSynthesis(1000);
      window.setTimeout(() => showHelp(), 120);
    });

    elements.albums?.addEventListener("change", (event) => {
      const checkbox = event.target.closest("[data-shoot-filter]");
      if (!checkbox) return;
      if (!requireUnlocked()) return;
      const shoot = checkbox.dataset.shootFilter || "";
      const next = new Set(selectedShootIds());
      if (checkbox.checked) next.add(shoot);
      else next.delete(shoot);
      state.shootFilters = normalizeShootFilters([...next]);
      state.album = primaryShootId();
      updateAutoActiveDeliverableName();
      state.selectedOnly = false;
      if (elements.selectedOnly) elements.selectedOnly.checked = false;
      render();
    });

    elements.filterForm?.addEventListener("submit", (event) => event.preventDefault());
    elements.search?.addEventListener("input", (event) => {
      state.query = event.target.value;
      renderGrid();
    });
    elements.sort?.addEventListener("change", (event) => {
      state.sort = event.target.value;
      renderGrid();
    });
    elements.mediaType?.addEventListener("change", (event) => {
      state.mediaType = event.target.value || "all";
      renderGrid();
    });
    document.querySelectorAll("[data-re-pdf-format]").forEach((input) => input.addEventListener("change", () => {
      if (input.checked) setPdfFormat(input.value);
    }));
    document.querySelectorAll("[data-re-pdf-orientation]").forEach((input) => input.addEventListener("change", () => {
      if (input.checked) setPdfOrientation(input.value);
    }));
    document.querySelectorAll("[data-re-slideshow-photo-seconds]").forEach((input) => input.addEventListener("change", () => {
      if (input.checked) setSlideshowPhotoSeconds(input.value);
    }));
    elements.slideshowMusicCountry?.addEventListener("change", (event) => {
      setSlideshowMusicCountry(event.target.value);
    });
    elements.watermarkEnabled?.addEventListener("change", (event) => {
      setWatermarkEnabled(event.target.checked);
    });
    elements.watermarkText?.addEventListener("change", (event) => {
      setWatermarkText(event.target.value);
    });
    elements.watermarkText?.addEventListener("blur", (event) => {
      setWatermarkText(event.target.value);
    });
    elements.selectedOnly?.addEventListener("change", (event) => {
      state.selectedOnly = event.target.checked;
      renderGrid();
    });

    app.addEventListener("click", (event) => {
      const openButton = event.target.closest("[data-open-photo]");
      if (openButton && requireUnlocked()) {
        const photoId = openButton.dataset.openPhoto;
        if (state.wizardStep === 1) {
          const photo = state.photosById.get(photoId);
          const selected = !isSelectedForActiveProject(photo);
          if (event.shiftKey && state.lastRangePhotoId) {
            setSelectedRange(state.lastRangePhotoId, photoId, selected);
          } else {
            setSelected(photoId, selected);
          }
          state.lastRangePhotoId = photoId;
          return;
        }
        showPhoto(photoId);
      }

      if (event.target.closest("[data-re-clear-filters]")) {
        state.query = "";
        state.mediaType = "all";
        state.sort = "album";
        state.selectedOnly = false;
        if (elements.search) elements.search.value = "";
        if (elements.mediaType) elements.mediaType.value = "all";
        if (elements.sort) elements.sort.value = "album";
        if (elements.selectedOnly) elements.selectedOnly.checked = false;
        render();
      }
      if (event.target.closest("[data-re-select-visible]")) selectVisible();
    });

    elements.grid?.addEventListener("change", (event) => {
      const checkbox = event.target.closest("[data-select-photo]");
      if (checkbox) {
        if (event.shiftKey && state.lastRangePhotoId) {
          setSelectedRange(state.lastRangePhotoId, checkbox.dataset.selectPhoto, checkbox.checked);
        } else {
          setSelected(checkbox.dataset.selectPhoto, checkbox.checked);
        }
        state.lastRangePhotoId = checkbox.dataset.selectPhoto;
      }
      const projectCheckbox = event.target.closest("[data-project-photo][data-project-id]");
      if (projectCheckbox) {
        setPhotoProject(
          projectCheckbox.dataset.projectPhoto,
          projectCheckbox.dataset.projectId,
          projectCheckbox.checked
        );
      }
    });
    elements.grid?.addEventListener("input", (event) => {
      const input = event.target.closest("[data-title-photo]");
      if (input) setTitle(input.dataset.titlePhoto, input.value);
    });
    elements.grid?.addEventListener("click", (event) => {
      const removeButton = event.target.closest("[data-remove-title-photo]");
      if (removeButton) {
        setSelected(removeButton.dataset.removeTitlePhoto, false);
      }
    });

    elements.draftList?.addEventListener("click", (event) => {
      const moveButton = event.target.closest("[data-move-draft]");
      const removeButton = event.target.closest("[data-remove-draft]");
      if (moveButton) moveDraftItem(moveButton.dataset.moveDraft, moveButton.dataset.direction);
      if (removeButton) setSelected(removeButton.dataset.removeDraft, false);
    });
    elements.draftList?.addEventListener("dragstart", (event) => {
      if (event.target.closest("button:not([data-draft-drag-handle])")) {
        event.preventDefault();
        return;
      }
      const item = event.target.closest("[data-draft-photo]");
      if (!item) return;
      state.dragDraftId = item.dataset.draftPhoto || "";
      item.classList.add("is-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", state.dragDraftId);
    });
    elements.draftList?.addEventListener("dragover", (event) => {
      if (!state.dragDraftId) return;
      const target = showDraftDropHint(event);
      if (!target) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    });
    elements.draftList?.addEventListener("dragleave", (event) => {
      const item = event.target.closest("[data-draft-photo]");
      if (item && !item.contains(event.relatedTarget)) {
        item.classList.remove("is-drop-before", "is-drop-after");
      }
    });
    elements.draftList?.addEventListener("drop", (event) => {
      const draggedId = state.dragDraftId || event.dataTransfer.getData("text/plain");
      if (!draggedId) return;
      if (!state.dragDraftId) state.dragDraftId = draggedId;
      const target = draftDropTarget(event);
      if (!target) return;
      event.preventDefault();
      clearDraftDropHints();
      moveDraftItemTo(draggedId, target.item.dataset.draftPhoto, target.position);
      state.dragDraftId = "";
    });
    elements.draftList?.addEventListener("dragend", (event) => {
      event.target.closest("[data-draft-photo]")?.classList.remove("is-dragging");
      clearDraftDropHints();
      state.dragDraftId = "";
    });
    elements.draftList?.addEventListener("pointerdown", (event) => {
      const handle = event.target.closest("[data-draft-drag-handle]");
      if (event.button !== 0 || event.target.closest("button:not([data-draft-drag-handle])")) return;
      const item = event.target.closest("[data-draft-photo]");
      if (!item) return;
      if (event.pointerType !== "mouse" && !handle) return;
      if (handle) event.preventDefault();
      state.pointerDraftId = item.dataset.draftPhoto || "";
      state.dragDraftId = state.pointerDraftId;
      state.pointerDraftStartX = event.clientX;
      state.pointerDraftStartY = event.clientY;
      state.pointerDraftActive = false;
      item.setPointerCapture?.(event.pointerId);
    });
    elements.draftList?.addEventListener("pointermove", (event) => {
      if (!state.pointerDraftId) return;
      const distance = Math.hypot(event.clientX - state.pointerDraftStartX, event.clientY - state.pointerDraftStartY);
      if (!state.pointerDraftActive && distance < 6) return;
      if (!state.pointerDraftActive) {
        state.pointerDraftActive = true;
        draftElementFor(state.pointerDraftId)?.classList.add("is-dragging");
      }
      event.preventDefault();
      showDraftDropHint(event);
    });
    elements.draftList?.addEventListener("pointerup", (event) => {
      if (!state.pointerDraftId) return;
      const draggedId = state.pointerDraftId;
      const target = state.pointerDraftActive ? draftDropTarget(event) : null;
      resetPointerDraftDrag();
      if (target) moveDraftItemTo(draggedId, target.item.dataset.draftPhoto, target.position);
    });
    elements.draftList?.addEventListener("pointercancel", resetPointerDraftDrag);

    document.querySelectorAll("[data-re-step-jump]").forEach((button) => button.addEventListener("click", () => {
      setWizardStep(button.dataset.reStepJump);
    }));
    document.querySelectorAll("[data-re-step-back]").forEach((button) => button.addEventListener("click", () => {
      setWizardStep(state.wizardStep - 1);
    }));
    document.querySelectorAll("[data-re-step-next]").forEach((button) => button.addEventListener("click", () => {
      setWizardStep(state.wizardStep + 1);
    }));
    document.querySelectorAll("[data-re-slideshow-orientation]").forEach((input) => input.addEventListener("change", () => {
      if (input.checked) setSlideshowOrientation(input.dataset.reSlideshowOrientation);
    }));
    document.addEventListener("click", (event) => {
      const createProduct = event.target?.closest?.("[data-re-create-product]");
      if (createProduct) {
        event.preventDefault();
        startNewProduct();
        return;
      }
      const shelfBack = event.target?.closest?.("[data-re-shelf-back]");
      if (!shelfBack) return;
      event.preventDefault();
      returnToShelf();
    });
    document.querySelectorAll("[data-re-open-outputs]").forEach((button) => button.addEventListener("click", () => {
      openSelectedOutputs().catch(() => setStatus("Outputs could not be opened"));
    }));
    document.querySelectorAll("[data-re-download-outputs]").forEach((button) => button.addEventListener("click", () => {
      downloadSelectedOutputs().catch(() => setStatus("Outputs could not be downloaded"));
    }));
    elements.activeProductName?.addEventListener("change", (event) => {
      renameActiveProduct(event.target.value).catch(() => setStatus("Could not rename this selection"));
    });
    elements.activeProductName?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      event.target.blur();
    });
    document.querySelectorAll("[data-re-copy-batch]").forEach((button) => button.addEventListener("click", copyBatch));
    document.querySelectorAll("[data-re-download-batch]").forEach((button) => button.addEventListener("click", () => {
      shareSelectionTable().catch(() => setStatus("Selection could not be saved"));
    }));
    document.querySelectorAll("[data-re-view-slideshow]").forEach((button) => button.addEventListener("click", () => {
      shareSlideshowPlan({ mode: "view" }).catch(() => setStatus("Video output could not be viewed"));
    }));
    document.querySelectorAll("[data-re-download-slideshow]").forEach((button) => button.addEventListener("click", () => {
      const readyUrl = button.dataset.reReadyDownloadUrl || "";
      if (readyUrl) {
        openDeliverableUrl(readyUrl, "download").catch(() => setStatus("Video output could not be downloaded"));
        return;
      }
      shareSlideshowPlan({ mode: "download" }).catch(() => setStatus("Video output could not be downloaded"));
    }));
    document.querySelectorAll("[data-re-download-originals]").forEach((button) => button.addEventListener("click", () => {
      shareOriginalsZip().catch(() => setStatus("Originals ZIP failed"));
    }));
    document.querySelectorAll("[data-re-view-pdf]").forEach((button) => button.addEventListener("click", () => downloadPdf({ mode: "view" })));
    document.querySelectorAll("[data-re-download-pdf]").forEach((button) => button.addEventListener("click", () => {
      const readyUrl = button.dataset.reReadyDownloadUrl || "";
      if (readyUrl) {
        downloadReadyOutputUrl({
          url: readyUrl,
          format: "pdf",
          filename: button.dataset.reReadyDownloadFilename || "",
        }).catch(() => setStatus("PDF output could not be downloaded"));
        return;
      }
      downloadPdf({ mode: "download" });
    }));
    elements.deliverablesList?.addEventListener("click", (event) => {
      if (event.target?.closest?.("[data-re-rename-deliverable]")) return;
      const button = event.target?.closest?.("[data-re-download-output-url], [data-re-edit-name], [data-re-edit-deliverable], [data-re-view-deliverable], [data-re-download-deliverable], [data-re-delete-deliverable]");
      if (button) {
        event.preventDefault();
        event.stopPropagation();
        if (button.matches("[data-re-download-output-url]")) {
          downloadReadyOutputUrl({
            url: button.getAttribute("data-re-download-output-url") || "",
            format: button.getAttribute("data-re-download-output-format") || "",
            filename: button.getAttribute("data-re-download-output-filename") || "",
          })
            .catch(() => setStatus("Could not download this output"));
          return;
        }
        if (button.matches("[data-re-edit-name]")) {
          beginDeliverableNameEdit(button.getAttribute("data-re-edit-name") || "");
          return;
        }
        if (button.matches("[data-re-edit-deliverable]")) {
          editProducedDeliverable(button.getAttribute("data-re-edit-deliverable") || "").catch(() => setStatus("Could not edit this product"));
          return;
        }
        if (button.matches("[data-re-delete-deliverable]")) {
          deleteProducedDeliverable(button.getAttribute("data-re-delete-deliverable") || "").catch((error) => setStatus(error?.message || "Could not delete this product"));
          return;
        }
        const mode = button.matches("[data-re-view-deliverable]") ? "view" : "download";
        const id = button.getAttribute(mode === "view" ? "data-re-view-deliverable" : "data-re-download-deliverable") || "";
        runProducedDeliverable(id, mode).catch(() => setStatus("Could not prepare this product"));
        return;
      }
      const row = event.target?.closest?.("[data-re-open-deliverable]");
      if (row) {
        editProducedDeliverable(row.getAttribute("data-re-open-deliverable") || "").catch(() => setStatus("Could not edit this selection"));
      }
    });
    elements.deliverablesList?.addEventListener("change", (event) => {
      const input = event.target?.closest?.("[data-re-rename-deliverable]");
      if (!input) return;
      renameProducedDeliverable(input.getAttribute("data-re-rename-deliverable") || "", input.value).catch(() => setStatus("Could not rename this product"));
    });
    elements.deliverablesList?.addEventListener("focusout", (event) => {
      const input = event.target?.closest?.("[data-re-rename-deliverable]");
      if (!input || state.editingDeliverableNameId !== input.getAttribute("data-re-rename-deliverable")) return;
      renameProducedDeliverable(input.getAttribute("data-re-rename-deliverable") || "", input.value).catch(() => setStatus("Could not rename this product"));
    });
    elements.deliverablesList?.addEventListener("keydown", (event) => {
      const input = event.target?.closest?.("[data-re-rename-deliverable]");
      if (input) {
        if (event.key !== "Enter") return;
        event.preventDefault();
        input.blur();
        return;
      }
      const row = event.target?.closest?.("[data-re-open-deliverable]");
      if (!row || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      editProducedDeliverable(row.getAttribute("data-re-open-deliverable") || "").catch(() => setStatus("Could not edit this selection"));
    });
    document.querySelectorAll("[data-re-load-batch]").forEach((button) => button.addEventListener("click", () => {
      openBatchFile().catch(() => setStatus("Selection file could not be loaded"));
    }));
    document.querySelectorAll("[data-re-help-open]").forEach((button) => button.addEventListener("click", () => showHelp({ force: true })));
    document.querySelector("[data-re-help-dismiss]")?.addEventListener("click", dismissHelp);
    elements.originalsForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      completeOriginalsPassword();
    });
    document.querySelectorAll("[data-re-originals-cancel]").forEach((button) => button.addEventListener("click", cancelOriginalsPassword));
    elements.originalsDialog?.addEventListener("close", () => {
      if (state.originalsCredentialRequest) cancelOriginalsPassword();
    });
    document.querySelectorAll("[data-re-clear-selection]").forEach((button) => button.addEventListener("click", clearSelection));
    const logoutRealEstateSession = () => {
      const baseUrl = workerBaseUrl();
      if (baseUrl) {
        fetch(`${baseUrl}/real-estate/logout`, {
          method: "POST",
          credentials: "include",
        }).catch(() => {});
      }
      clearAuthState();
      syncAuthUi();
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
    document.querySelectorAll("[data-re-logout]").forEach((button) => button.addEventListener("click", logoutRealEstateSession));
    window.addEventListener("photosbyelie:scopedaccountlogout", (event) => {
      if (event.detail?.kind === "real-estate") logoutRealEstateSession();
    });
    document.querySelector("[data-re-load-batch-input]")?.addEventListener("change", (event) => {
      loadBatchFile(event.target.files?.[0]).catch(() => setStatus("Selection file could not be loaded"));
      event.target.value = "";
    });

    const syncDialogTitleInput = (event) => setTitle(state.activePhotoId, event.target.value);
    elements.dialogTitleInput?.addEventListener("input", syncDialogTitleInput);
    elements.dialogTitleInput?.addEventListener("change", syncDialogTitleInput);
    elements.dialogSelected?.addEventListener("change", (event) => setSelected(state.activePhotoId, event.target.checked));
    document.querySelector("[data-re-dialog-prev]")?.addEventListener("click", () => stepDialog(-1));
    document.querySelector("[data-re-dialog-next]")?.addEventListener("click", () => stepDialog(1));
    elements.dialog?.addEventListener("click", (event) => {
      if (event.target === elements.dialog) elements.dialog.close?.();
    });
    elements.helpDialog?.addEventListener("click", (event) => {
      if (event.target === elements.helpDialog) dismissHelp();
    });
    elements.helpDialog?.addEventListener("close", () => {
      writeStorageFlag(helpDismissedGlobalKey);
      writeStorageFlag(helpDismissedKey());
    });
    document.addEventListener("keydown", (event) => {
      if (!elements.dialog?.open) return;
      if (event.key === "ArrowLeft") stepDialog(-1);
      if (event.key === "ArrowRight") stepDialog(1);
    });
    window.addEventListener("photosbyelie:languagechange", () => render());
  };

  const initializeFromPayload = (payload) => {
    const galleryKey = payload?.gallery?.key || window.photosByElieRealEstateGalleryKey;
    const gallery = payload?.gallery || (galleryKey ? window.photosByElieData?.[galleryKey] : null);
    const photos = Array.isArray(gallery?.photos) ? gallery.photos : [];
    state.payload = payload || {};
    state.gallery = gallery;
    state.photos = photos;
    state.photosById = new Map(photos.map((photo) => [photo.id, photo]));
    state.albums = Array.isArray(payload?.albums)
      ? payload.albums
      : [...new Map(photos.map((photo) => [photo.albumSlug, {
        slug: photo.albumSlug,
        displayTitle: albumTitleFor(photo),
        photoCount: photos.filter((candidate) => candidate.albumSlug === photo.albumSlug).length,
      }])).values()];
    if (!state.album || state.album === "all" || !state.albums.some((album) => album.slug === state.album)) {
      state.album = defaultAlbumSlug();
    }
    state.shootFilters = normalizeShootFilters(state.shootFilters);
    if (!state.shootFilters.length && state.album) state.shootFilters = [state.album];
    state.wizardStep = firstWizardStep();
    state.selectedOrder = normalizeSelectedOrder(readJson(selectionStoreKey(), []));
    state.selectedIds = new Set(state.selectedOrder);
    state.editedTitles = readJson(titleStoreKey(), {});
    state.projectAssignments = readJson(projectStoreKey(), {});
    const requestedStep = requestedWizardStepFromUrl();
    if (requestedStep !== null) {
      state.wizardStep = requestedStep >= 2 && activeSelectedPhotos().length === 0
        ? Math.min(firstWizardStep(), 1)
        : Math.max(firstWizardStep(), requestedStep);
    }
    const savedDeliverables = readJson(localDeliverablesStoreKey(), []);
    state.localDeliverables = Array.isArray(savedDeliverables) ? savedDeliverables : [];
    if (pageParams.has("logout")) {
      clearAuthState();
    }
    state.unlocked = hasUnlockedSession();
    const savedCredentials = readSessionCredentials();
    const savedSession = readJson(authStoreKey(), {});
    state.username = savedCredentials.username || savedSession.username || state.payload?.customer?.username || state.payload?.customer?.name || "";
    state.accessCode = "";
    state.density = "balanced";
    state.pdfFormat = paperFormatFor(state.pdfFormat).key;
    state.pdfOrientation = normalizePdfOrientation(state.pdfOrientation);
    state.slideshowPhotoSeconds = [3, 4, 5].includes(Number(state.slideshowPhotoSeconds))
      ? Number(state.slideshowPhotoSeconds)
      : 4;
    state.slideshowOrientation = normalizeSlideshowOrientation(state.slideshowOrientation);
    state.slideshowMusicCountry = normalizeSlideshowMusicCountry(state.slideshowMusicCountry);
    if (!String(state.watermarkText || "").trim()) state.watermarkText = pdfWatermarkText;
    renderHero();
    render();
    loadSlideshowMusicManifest();
    if (state.unlocked) fetchCloudDeliverables({ quiet: true }).catch(() => {});
    if (state.unlocked) scheduleVideoExportSynthesis(1200);
  };

  const initialize = async () => {
    let initialized = false;
    try {
      if (!window.photosByElieRealEstateImport) await loadScript(contextUrl);
      if (!window.photosByElieRealEstateImport) throw new Error("No real-estate context loaded.");
      initializeFromPayload(window.photosByElieRealEstateImport);
      initialized = true;
    } catch (error) {
      elements.grid.innerHTML = `
        <div class="real-estate-empty-state">
          <strong>Real-estate gallery is not loaded.</strong>
          <span>Serve a local import bundle or pass ?context=/path/to/app-context.js.</span>
        </div>
      `;
      setStatus(error.message || "Real-estate gallery is not loaded");
    }
    bindEvents();
    if (initialized) {
      if (isCloudRenderMode) {
        state.unlocked = true;
        syncAuthUi();
        runCloudRenderJob().catch((error) => {
          console.error("Cloud render job failed", error);
          setCloudRenderStatus("failed", error?.message || "Cloud render job failed.");
        });
        return;
      }
      const accessMode = pageParams.get("access");
      if (!state.unlocked && accessMode === "google") {
        unlockFromAccessLogin({ redirectOnUnauthorized: false }).catch((error) => {
          window.location.replace(siteSignInUrl());
        });
      } else if (!state.unlocked && accessMode === "password") {
        const sessionUrl = new URL(`${workerBaseUrl()}/real-estate/session`);
        sessionUrl.searchParams.set("galleryKey", state.gallery?.key || "");
        fetch(sessionUrl.href, { cache: "no-store", credentials: "include" })
          .then(async (response) => {
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw realEstateWorkerError(response, body);
            const username = body?.session?.username || state.payload?.customer?.username || "";
            state.unlocked = true;
            writeSessionCredentials(username);
            writeSession(username);
            syncAuthUi();
            setStatus(`${state.photos.length} visible / ${state.photos.length} media`);
            fetchCloudDeliverables({ quiet: true }).catch(() => {});
            scheduleVideoExportSynthesis(1000);
          })
          .catch(() => window.location.replace(siteSignInUrl()));
      } else if (!state.unlocked) {
        window.location.replace(siteSignInUrl());
        return;
      }
      window.setTimeout(() => showHelp(), 160);
    }
  };

  initialize();
})();
