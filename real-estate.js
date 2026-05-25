(() => {
  const app = document.querySelector("[data-real-estate-app]");
  if (!app) return;

  const pageParams = new URLSearchParams(window.location.search);
  const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
  const pageVersion = pageParams.get("v");
  const contextVersion = pageVersion ? `?v=${encodeURIComponent(pageVersion)}` : "";
  const knownClientContexts = new Set(["corine", "elie"]);
  const requestedClientContext = String(pageParams.get("client") || "elie").trim().toLowerCase();
  const defaultClientContext = knownClientContexts.has(requestedClientContext) ? requestedClientContext : "elie";
  const defaultLocalContext = `./tmp/real-estate-import/${defaultClientContext}/app-context.js${contextVersion}`;
  const defaultPublicContext = `./assets/real-estate/${defaultClientContext}/app-context.js${contextVersion}`;
  const contextParam = pageParams.get("context");
  const contextUrl = contextParam || (isLocalHost ? defaultLocalContext : defaultPublicContext);
  const densityKey = "photosbyelie-real-estate-card-density";
  const pdfFormatKey = "photosbyelie-real-estate-pdf-format";
  const slideshowPhotoSecondsKey = "photosbyelie-real-estate-slideshow-photo-seconds";

  const clearLogoutFromHistory = () => {
    if (!pageParams.has("logout")) return;
    pageParams.delete("logout");
    if (!window.history?.replaceState) return;
    try {
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete("logout");
      window.history.replaceState(window.history.state, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
    } catch {
      // The current session is valid even if a browser blocks history cleanup.
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
    loginStatus: app.querySelector("[data-re-login-status]"),
    customer: app.querySelector("[data-re-customer]"),
    title: app.querySelector("[data-re-title]"),
    description: app.querySelector("[data-re-description]"),
    deliverablesPanel: app.querySelector("[data-re-deliverables-panel]"),
    deliverablesList: app.querySelector("[data-re-deliverables-list]"),
    total: app.querySelector("[data-re-total]"),
    albumTotal: app.querySelector("[data-re-album-total]"),
    selectedTotal: app.querySelector("[data-re-selected-total]"),
    albums: app.querySelector("[data-re-albums]"),
    filterForm: app.querySelector("[data-re-filter-form]"),
    search: app.querySelector("[data-re-search]"),
    sort: app.querySelector("[data-re-sort]"),
    mediaType: app.querySelector("[data-re-media-type]"),
    density: app.querySelector("[data-re-density]"),
    selectedOnly: app.querySelector("[data-re-selected-only]"),
    pdfFormat: app.querySelector("[data-re-pdf-format]"),
    slideshowPhotoSeconds: app.querySelector("[data-re-slideshow-photo-seconds]"),
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
    wizardStep: 0,
    query: "",
    mediaType: "all",
    sort: "album",
    density: localStorage.getItem(densityKey) || "balanced",
    pdfFormat: localStorage.getItem(pdfFormatKey) || "a4",
    slideshowPhotoSeconds: Number(localStorage.getItem(slideshowPhotoSecondsKey)) || 4,
    selectedOnly: false,
    selectedOrder: [],
    selectedIds: new Set(),
    editedTitles: {},
    projectAssignments: {},
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
    const override = normalizedWorkerBase(pageParams.get("workerBase"));
    if (override) return override;
    const configured = normalizedWorkerBase(window.photosByElieMediaConfig?.checkoutWorkerBaseUrl || "");
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

  const workflow = () => state.payload?.cloudPdfWorkflow || {};
  const selectionStoreKey = () => workflow().selectionStoreKey || `photosbyelie-real-estate-liked-${state.gallery?.key || "default"}`;
  const titleStoreKey = () => workflow().titleStoreKey || `photosbyelie-real-estate-titles-${state.gallery?.key || "default"}`;
  const projectStoreKey = () => workflow().projectStoreKey || `photosbyelie-real-estate-projects-${state.gallery?.key || "default"}`;
  const authStoreKey = () => `photosbyelie-real-estate-session-${state.gallery?.key || "default"}`;
  const credentialSessionKey = () => `photosbyelie-real-estate-credentials-${state.gallery?.key || "default"}`;
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
    state.accessCode = String(accessCode || "");
    try {
      sessionStorage.setItem(credentialSessionKey(), JSON.stringify({
        username: state.username,
        accessCode: state.accessCode,
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
    const alreadyDismissed = readJson(helpDismissedKey(), false);
    if (!force && (alreadyDismissed || state.selectedOrder.length > 0)) return;
    openDialog(elements.helpDialog);
  };

  const dismissHelp = () => {
    writeJson(helpDismissedKey(), true);
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
  const expectedAccessCode = () => normalizeCredential(
    state.payload?.accessCode
    || state.payload?.customer?.accessCode
    || ""
  );
  const expectedAccessCodeHash = () => String(
    state.payload?.accessCodeHash
    || state.payload?.customer?.accessCodeHash
    || ""
  ).trim().toLowerCase();
  const expectedAccessCodeSalt = () => String(
    state.payload?.accessCodeSalt
    || state.payload?.customer?.accessCodeSalt
    || ""
  ).trim();

  const sha256Hex = async (value) => {
    if (!window.crypto?.subtle || typeof TextEncoder !== "function") return "";
    const bytes = new TextEncoder().encode(String(value || ""));
    const digest = await window.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  };

  const credentialMatches = async (enteredUser, enteredCode) => {
    if (!expectedLoginNames().has(enteredUser)) return false;
    const expectedHash = expectedAccessCodeHash();
    const salt = expectedAccessCodeSalt();
    if (expectedHash && salt) {
      const actualHash = await sha256Hex(`${salt}:${enteredCode}`);
      return Boolean(actualHash) && actualHash === expectedHash;
    }
    return Boolean(expectedAccessCode()) && enteredCode === expectedAccessCode();
  };

  const hasUnlockedSession = () => {
    const saved = readJson(authStoreKey(), {});
    return Boolean(
      saved?.unlocked
      && saved?.galleryKey === state.gallery?.key
      && expectedLoginNames().has(normalizeCredential(saved?.username))
    );
  };

  const writeSession = (username = "", accessCode = "") => writeJson(authStoreKey(), {
    galleryKey: state.gallery?.key || "",
    username,
    accessCode,
    unlocked: true,
    unlockedAt: new Date().toISOString(),
  });

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
      elements.loginCodeToggle.setAttribute("aria-label", showing ? "Hide password" : "Show password");
      elements.loginCodeToggle.setAttribute("aria-pressed", String(showing));
    }
  };

  const syncAuthUi = () => {
    app.classList.toggle("is-locked", !state.unlocked);
    if (elements.actionBar) elements.actionBar.hidden = !state.unlocked;
    if (elements.loginStatus && state.unlocked) elements.loginStatus.textContent = "";
    if (!state.unlocked && elements.loginCode) {
      elements.loginCode.value = "";
      elements.loginCode.type = "password";
    }
    renderLoginCodeIcon();
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

  const titleFor = (photo) => state.editedTitles[photo?.id] || photo?.editableTitle || photo?.title || photo?.id || "";
  const albumTitleFor = (photo) => photo?.albumTitle || photo?.caption || photo?.album || "Property";
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
  const paperFormatFor = (key = state.pdfFormat) => paperFormats[key] || paperFormats.a4;
  const pdfWatermarkText = "\u00a9 2026 Photos By Elie";
  const slideshowTransition = "random-ken-burns";
  const slideshowMusicTracks = Object.freeze([
    { title: "Quiet Linden Study", bpm: 82, duration: 113.02, src: "./assets/music/slideshow-guitar/quiet-linden-study-single-guitar-113s.mp3" },
    { title: "Warm Balcony Theme", bpm: 86, duration: 107.847, src: "./assets/music/slideshow-guitar/warm-balcony-theme-single-guitar-107s.mp3" },
    { title: "Open House Aria", bpm: 88, duration: 105.436, src: "./assets/music/slideshow-guitar/open-house-aria-single-guitar-104s.mp3" },
    { title: "Cedar Stairwell", bpm: 80, duration: 115.8, src: "./assets/music/slideshow-guitar/cedar-stairwell-single-guitar-116s.mp3" },
    { title: "Terrace in C", bpm: 84, duration: 110.371, src: "./assets/music/slideshow-guitar/terrace-in-c-single-guitar-109s.mp3" },
    { title: "Window Light Etude", bpm: 90, duration: 103.133, src: "./assets/music/slideshow-guitar/window-light-etude-single-guitar-103s.mp3" },
    { title: "Blue Hour Listing", bpm: 82, duration: 113.02, src: "./assets/music/slideshow-guitar/blue-hour-listing-single-guitar-112s.mp3" },
    { title: "Ivory Courtyard", bpm: 86, duration: 107.847, src: "./assets/music/slideshow-guitar/ivory-courtyard-single-guitar-106s.mp3" },
    { title: "Sunday Parlor", bpm: 84, duration: 110.371, src: "./assets/music/slideshow-guitar/sunday-parlor-single-guitar-108s.mp3" },
    { title: "Soft Key Return", bpm: 90, duration: 103.133, src: "./assets/music/slideshow-guitar/soft-key-return-single-guitar-101s.mp3" },
  ]);
  const slideshowMusicGainDb = 0;
  const sourceVideoAudioGainDb = -20;
  const sourceVideoAudioLinearGain = 10 ** (sourceVideoAudioGainDb / 20);
  const absoluteTrackUrl = (track) => {
    if (!track?.src) return "";
    try {
      return new URL(track.src, window.location.href).href;
    } catch {
      return track.src;
    }
  };
  const withAbsoluteTrackUrl = (track) => track ? { ...track, absoluteSrc: absoluteTrackUrl(track) } : null;
  const chooseSlideshowMusicTrack = () => withAbsoluteTrackUrl(
    slideshowMusicTracks[Math.floor(Math.random() * slideshowMusicTracks.length)] || slideshowMusicTracks[0]
  );
  const slideshowAudioPolicyFor = (musicTrack = null) => ({
    selection: "random-from-single-guitar-pool",
    musicGainDb: slideshowMusicGainDb,
    sourceVideoAudioGainDb,
    sourceVideoAudioLinearGain,
    musicTrack: musicTrack ? { ...musicTrack, musicGainDb: slideshowMusicGainDb } : null,
    musicPool: slideshowMusicTracks.map((track) => ({ ...track })),
  });
  const slideshowSettingsFor = (musicTrack = null) => ({
    mode: "one-slideshow-per-project",
    photoDurationSeconds: state.slideshowPhotoSeconds,
    videoDurationPolicy: "preserve-source-duration",
    transition: slideshowTransition,
    effects: "random-ken-burns",
    audioPolicy: slideshowAudioPolicyFor(musicTrack),
  });
  const kenBurnsEffects = Object.freeze([
    "slow-zoom-in",
    "slow-zoom-out",
    "pan-left",
    "pan-right",
    "rise-up",
    "drift-down",
  ]);
  const randomKenBurnsEffect = () => kenBurnsEffects[Math.floor(Math.random() * kenBurnsEffects.length)] || "slow-zoom-in";
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

  const selectedPropertyTitle = () => (
    state.albums.find((album) => album.slug === state.album)?.displayTitle
    || state.albums.find((album) => album.slug === state.album)?.title
    || "this property"
  );

  const filteredPhotos = () => {
    const query = state.query.trim().toLowerCase();
    const selectedRank = new Map(state.selectedOrder.map((id, index) => [id, index]));
    const selectedOnly = state.selectedOnly || state.wizardStep === 2;
    const photos = state.photos.filter((photo) => {
      if (state.wizardStep !== 1 && state.album && state.album !== "all" && photo.albumSlug !== state.album && !assignedProjectIdsFor(photo).includes(state.album)) return false;
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
    if (!value) return "almost done";
    if (value < 60) return `${value}s left`;
    const minutes = Math.floor(value / 60);
    const remainder = value % 60;
    return `${minutes}m ${String(remainder).padStart(2, "0")}s left`;
  };
  const formatBytes = (bytes) => {
    const value = Number(bytes) || 0;
    if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
    if (value >= 1024) return `${Math.round(value / 1024)} KB`;
    return `${value} bytes`;
  };
  const deliverableActionNote = "View on mobile, or download on a computer. Capture or share whatever you are seeing with your device tools.";
  const shouldOpenHtmlVideoDownloadsInBrowser = () => {
    const userAgent = String(navigator.userAgent || "");
    const mobileUserAgent = /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
    const iPadDesktopUserAgent = /Macintosh/i.test(userAgent) && Number(navigator.maxTouchPoints || 0) > 1;
    const coarsePointer = Boolean(window.matchMedia?.("(pointer: coarse)")?.matches);
    const narrowViewport = Boolean(window.matchMedia?.("(max-width: 900px)")?.matches);
    return mobileUserAgent || iPadDesktopUserAgent || (coarsePointer && narrowViewport);
  };
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
    if (elements.outputProgressTitle) elements.outputProgressTitle.textContent = title || (done ? "Done" : "Working...");
    if (elements.outputProgressDetail) elements.outputProgressDetail.textContent = detail || "";
    if (elements.outputProgressEta) elements.outputProgressEta.textContent = done ? "" : outputProgressEta(safeCurrent, safeTotal);
    if (elements.outputProgressBar) {
      if (safeTotal > 0) {
        elements.outputProgressBar.max = 100;
        elements.outputProgressBar.value = done ? 100 : Math.round((safeCurrent / safeTotal) * 100);
      } else {
        elements.outputProgressBar.removeAttribute("value");
      }
    }
  };
  const startOutputProgress = ({ title = "Working...", detail = "", total = 0, kind = "output" } = {}) => {
    state.outputBusy = true;
    state.outputBusyKind = kind;
    state.outputProgressStartedAt = Date.now();
    updateOutputProgress({ title, detail, current: 0, total });
    setStatus(detail || title);
    syncFileActionLabels();
  };
  const completeOutputProgress = (detail = "Done") => {
    updateOutputProgress({ title: "Done", detail, current: 1, total: 1, done: true });
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
    updateOutputProgress({ title: "Needs attention", detail, current: 0, total: 1 });
    state.outputBusy = false;
    state.outputBusyKind = "";
    state.outputProgressStartedAt = 0;
    syncFileActionLabels();
  };

  const syncFileActionLabels = () => {
    const outputBusy = state.outputBusy || state.pdfBusy;
    const kind = state.outputBusyKind;
    const noActiveSelection = activeSelectedPhotos().length === 0;
    document.querySelectorAll("[data-re-open-outputs]").forEach((button) => {
      button.textContent = outputBusy && kind === "outputs-view" ? "Working..." : "View selected outputs";
      button.title = "View selected PDF and video outputs in the browser, useful on mobile";
      button.disabled = outputBusy || noActiveSelection;
    });
    document.querySelectorAll("[data-re-download-outputs]").forEach((button) => {
      button.textContent = outputBusy && kind === "outputs-download" ? "Working..." : "Download selected outputs";
      button.title = "Download selected PDF and video outputs for desktop file handling";
      button.disabled = outputBusy || noActiveSelection;
    });
    document.querySelectorAll("[data-re-view-pdf]").forEach((button) => {
      button.textContent = outputBusy && kind === "pdf-view" ? "Building PDF..." : "Preview PDF";
      button.title = "Preview project PDFs in a mobile-safe browser page; selected videos appear as stills from 10% in";
      button.disabled = outputBusy || noActiveSelection;
    });
    document.querySelectorAll("[data-re-download-pdf]").forEach((button) => {
      button.textContent = outputBusy && kind === "pdf-download" ? "Building PDF..." : "Download PDF";
      button.title = "Download project PDFs; selected videos appear as stills from 10% in";
      button.disabled = outputBusy || noActiveSelection;
    });
    document.querySelectorAll("[data-re-view-slideshow]").forEach((button) => {
      button.textContent = outputBusy && kind === "video-view" ? "Preparing video..." : "View video";
      button.title = "View a browser slideshow/video output with random single-guitar music";
      button.disabled = outputBusy || noActiveSelection;
    });
    document.querySelectorAll("[data-re-download-slideshow]").forEach((button) => {
      const mobileOpen = shouldOpenHtmlVideoDownloadsInBrowser();
      button.textContent = outputBusy && kind === "video-download" ? "Preparing video..." : (mobileOpen ? "Open video" : "Download video");
      button.title = mobileOpen
        ? "Open the video output in the browser; use your phone share controls if needed"
        : "Download the video output with random single-guitar music; selected videos keep duration and play 20 dB under the music";
      button.disabled = outputBusy || noActiveSelection;
    });
    document.querySelectorAll("[data-re-download-batch]").forEach((button) => {
      button.textContent = outputBusy && kind === "selection" ? "Preparing..." : "Share selection table";
      button.title = "Open or share an HTML table that can be loaded back later";
      button.disabled = outputBusy || noActiveSelection;
    });
    document.querySelectorAll("[data-re-download-originals]").forEach((button) => {
      button.textContent = state.originalsBusy ? "Building originals ZIP..." : "Share originals ZIP";
      button.title = "Prepare a ZIP of selected original source media from private delivery storage";
      button.disabled = state.originalsBusy || outputBusy || selectedPhotos().length === 0;
    });
    document.querySelectorAll("[data-re-view-deliverable], [data-re-download-deliverable], [data-re-edit-deliverable]").forEach((button) => {
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

  const isSelectedForActiveProject = (photo) => (
    state.selectedIds.has(photo?.id)
    && selectedProjectIdsFor(photo).includes(activeProjectId())
  );

  const activeSelectedPhotos = () => selectedPhotos().filter(isSelectedForActiveProject);

  const defaultAlbumSlug = () => state.albums[0]?.slug || "all";

  const hasPropertyPicker = () => state.albums.length > 1;

  const firstWizardStep = () => hasPropertyPicker() ? 0 : 1;

  const normalizeWizardStep = (step) => Math.max(firstWizardStep(), Math.min(4, Number(step) || firstWizardStep()));

  const activeProjectId = () => (state.album && state.album !== "all" ? state.album : defaultAlbumSlug());

  const renderHero = () => {
    const { gallery, payload, photos } = state;
    const albums = state.albums;
    if (elements.loginCustomer) elements.loginCustomer.textContent = "Private client access";
    if (elements.customer) elements.customer.textContent = payload?.customer?.name ? `${payload.customer.name} review` : "Client review";
    if (elements.title) elements.title.textContent = gallery?.title || "Real estate selection";
    if (elements.description) elements.description.textContent = gallery?.description || "Private media review workspace for project PDFs and slideshow delivery.";
    if (elements.total) elements.total.textContent = String(photos.length);
    if (elements.total?.previousElementSibling) elements.total.previousElementSibling.textContent = "Media";
    if (elements.albumTotal) elements.albumTotal.textContent = String(albums.length);
    renderProducedDeliverables();
  };

  const absoluteDeliverableUrl = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return "";
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
      accessCode: String(
        state.accessCode
        || savedCredentials.accessCode
        || savedSession.accessCode
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
    const ready = !row?.status || ["ready", "complete", "completed", "published"].includes(String(row.status).toLowerCase());
    const viewUrl = absoluteDeliverableUrl(row?.viewUrl || row?.watchUrl || row?.url || row?.href);
    const downloadUrl = absoluteDeliverableUrl(row?.downloadUrl || row?.fileUrl || row?.url || row?.href);
    const editUrl = absoluteDeliverableUrl(row?.editUrl || row?.batchUrl || row?.manifestUrl || row?.selectionUrl || row?.sourceBatchUrl);
    return {
      id: String(row?.id || row?.deliverableId || `${type}-${index + 1}`),
      type,
      label: type === "pdf" ? "PDF" : type === "video" || type === "mp4" ? "Video" : "File",
      title: String(row?.title || row?.projectTitle || row?.name || `Deliverable ${index + 1}`),
      createdAt: String(row?.createdAt || row?.generatedAt || row?.updatedAt || ""),
      bytes: Number(row?.bytes || row?.size || 0) || 0,
      status: ready ? "ready" : String(row?.status || "pending"),
      viewUrl,
      downloadUrl,
      editUrl,
      batch: row?.batch || row?.manifest || row?.selection || null,
      filename: String(row?.filename || row?.fileName || ""),
      source: String(row?.__deliverableSource || ""),
    };
  };

  const producedDeliverables = () => {
    const seen = new Set();
    return rawDeliverables()
      .map(normalizeDeliverable)
      .filter((item) => item.title || item.viewUrl || item.downloadUrl || item.editUrl || item.batch)
      .filter((item) => {
        const key = item.id || `${item.type}:${item.createdAt}:${item.title}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  };

  const localDeliverableTitleFor = (type, batch) => {
    const label = type === "pdf" ? "PDF" : "Video";
    const projectTitles = (Array.isArray(batch?.projects) ? batch.projects : [])
      .map((project) => String(project?.projectTitle || "").trim())
      .filter(Boolean);
    const uniqueTitles = projectTitles.filter((title, index, items) => items.indexOf(title) === index);
    if (uniqueTitles.length === 1) return `${label}: ${uniqueTitles[0]}`;
    if (uniqueTitles.length > 1) return `${label}: ${uniqueTitles.length} projects`;
    return `${label}: ${state.payload?.customer?.name || state.gallery?.title || "Real estate product"}`;
  };

  const cloneBatch = (batch) => {
    try {
      return JSON.parse(JSON.stringify(batch));
    } catch {
      return batch;
    }
  };

  const credentialsForCloudDeliverables = async ({ promptIfMissing = false } = {}) => {
    const credentials = cloudCredentialSnapshot();
    if (!credentials.accessCode && promptIfMissing) {
      credentials.accessCode = await promptOriginalsPassword("Enter the client password to sync products saved in the cloud.");
    }
    if (!credentials.username || !credentials.accessCode) return null;
    writeSessionCredentials(credentials.username, credentials.accessCode);
    if (state.unlocked) writeSession(credentials.username, credentials.accessCode);
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
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          galleryKey: state.gallery?.key || "",
          username: credentials.username,
          accessCode: credentials.accessCode,
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
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        galleryKey: state.gallery?.key || "",
        username: credentials.username,
        accessCode: credentials.accessCode,
        deliverable: record,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body?.error?.message || "Cloud product could not be saved.");
    }
    const saved = body.deliverable || record;
    const existing = Array.isArray(state.cloudDeliverables) ? state.cloudDeliverables : [];
    state.cloudDeliverables = [saved, ...existing.filter((item) => item?.id !== saved.id)].slice(0, 50);
    state.cloudDeliverablesLoaded = true;
    state.cloudDeliverablesError = "";
    renderProducedDeliverables();
    return saved;
  };

  const removeLocalDeliverable = (deliverableId) => {
    const before = Array.isArray(state.localDeliverables) ? state.localDeliverables : [];
    state.localDeliverables = before.filter((item) => String(item?.id || "") !== deliverableId);
    writeJson(localDeliverablesStoreKey(), state.localDeliverables);
  };

  const removeCloudDeliverableState = (deliverableId) => {
    const before = Array.isArray(state.cloudDeliverables) ? state.cloudDeliverables : [];
    state.cloudDeliverables = before.filter((item) => String(item?.id || "") !== deliverableId);
  };

  const deleteCloudDeliverable = async (deliverableId, { promptIfMissing = false } = {}) => {
    const baseUrl = workerBaseUrl();
    if (!state.gallery?.key || !baseUrl || !state.unlocked) {
      if (promptIfMissing) throw new Error("Cloud products are unavailable.");
      return null;
    }
    const credentials = await credentialsForCloudDeliverables({ promptIfMissing });
    if (!credentials) {
      if (promptIfMissing) throw new Error("Client password is needed to delete this cloud product.");
      return null;
    }
    const response = await fetch(`${baseUrl}/real-estate/deliverables/delete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        galleryKey: state.gallery?.key || "",
        username: credentials.username,
        accessCode: credentials.accessCode,
        id: deliverableId,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body?.error?.message || "Cloud product could not be deleted.");
    }
    return body;
  };

  const deleteProducedDeliverable = async (deliverableId) => {
    if (!requireUnlocked()) return;
    const item = producedDeliverables().find((deliverable) => deliverable.id === deliverableId);
    if (!item || !["cloud", "local"].includes(item.source)) return;
    const confirmed = window.confirm(`Delete ${item.title || item.label || "this product"} from saved products?`);
    if (!confirmed) return;

    setStatus(`Deleting ${item.title || item.label || "product"}...`);
    if (item.source === "cloud") {
      await deleteCloudDeliverable(deliverableId, { promptIfMissing: true });
    } else {
      deleteCloudDeliverable(deliverableId, { promptIfMissing: false }).catch((error) => {
        state.cloudDeliverablesError = error?.message || "Cloud product could not be deleted.";
        renderProducedDeliverables();
      });
    }
    removeLocalDeliverable(deliverableId);
    removeCloudDeliverableState(deliverableId);
    renderProducedDeliverables();
    setStatus(`Deleted ${item.title || item.label || "product"} from saved products.`);
  };

  const saveLocalDeliverable = ({ type = "file", batch = null, filename = "", bytes = 0 } = {}) => {
    if (!batch?.batchId) return null;
    const normalizedType = String(type || "file").toLowerCase();
    const record = {
      id: `local-${normalizedType}-${batch.batchId}`,
      type: normalizedType,
      title: localDeliverableTitleFor(normalizedType, batch),
      createdAt: batch.createdAt || new Date().toISOString(),
      status: "ready",
      bytes: Number(bytes) || 0,
      filename: String(filename || ""),
      batch: cloneBatch(batch),
    };
    const existing = Array.isArray(state.localDeliverables) ? state.localDeliverables : [];
    state.localDeliverables = [record, ...existing.filter((item) => item?.id !== record.id)].slice(0, 25);
    writeJson(localDeliverablesStoreKey(), state.localDeliverables);
    renderProducedDeliverables();
    saveCloudDeliverable(record).catch((error) => {
      state.cloudDeliverablesError = error?.message || "Cloud product could not be saved.";
      renderProducedDeliverables();
    });
    return record;
  };

  const renderProducedDeliverables = () => {
    if (!elements.deliverablesPanel || !elements.deliverablesList) return;
    const items = producedDeliverables();
    if (!items.length) {
      const cloudCredentials = cloudCredentialSnapshot();
      const canOfferCloudSync = state.unlocked && workerBaseUrl() && !cloudCredentials.accessCode;
      const cloudNote = state.cloudDeliverablesBusy
        ? `<p class="real-estate-muted">Checking cloud products...</p>`
        : state.cloudDeliverablesError
          ? `<p class="real-estate-muted">Cloud products could not be reached. Local products on this device will still appear here.</p>`
          : canOfferCloudSync
            ? `<p class="real-estate-muted">This device needs the client password once to sync saved cloud products.</p>
              <button class="btn secondary" type="button" data-re-sync-deliverables>Sync saved products</button>`
            : "";
      elements.deliverablesList.innerHTML = `
        <p class="real-estate-muted">No produced PDFs or videos are ready yet. Create a PDF or video below, then finished cloud deliverables will appear here for repeat viewing and downloading.</p>
        ${cloudNote}
      `;
      syncFileActionLabels();
      return;
    }
    elements.deliverablesList.innerHTML = items.map((item) => {
      const date = item.createdAt ? new Date(item.createdAt) : null;
      const dateLabel = date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : item.createdAt;
      const meta = [
        item.label,
        item.status !== "ready" ? item.status : "",
        dateLabel,
        item.bytes ? formatBytes(item.bytes) : "",
      ].filter(Boolean).join(" / ");
      const view = item.viewUrl
        ? `<a class="btn secondary" href="${escapeHtml(item.viewUrl)}" target="_blank" rel="noopener">View</a>`
        : item.batch
          ? `<button class="btn secondary" type="button" data-re-view-deliverable="${escapeHtml(item.id)}">View</button>`
        : `<button class="btn secondary" type="button" disabled>View</button>`;
      const openVideoDownload = item.type === "video" && shouldOpenHtmlVideoDownloadsInBrowser();
      const download = item.downloadUrl
        ? openVideoDownload
          ? `<a class="btn secondary" href="${escapeHtml(item.viewUrl || item.downloadUrl)}" target="_blank" rel="noopener">Open</a>`
          : `<a class="btn secondary" href="${escapeHtml(item.downloadUrl)}" ${item.filename ? `download="${escapeHtml(item.filename)}"` : "download"}>Download</a>`
        : item.batch
          ? openVideoDownload
            ? `<button class="btn secondary" type="button" data-re-view-deliverable="${escapeHtml(item.id)}">Open</button>`
            : `<button class="btn secondary" type="button" data-re-download-deliverable="${escapeHtml(item.id)}">Download</button>`
        : `<button class="btn secondary" type="button" disabled>Download</button>`;
      const edit = (item.editUrl || item.batch)
        ? `<button class="btn secondary" type="button" data-re-edit-deliverable="${escapeHtml(item.id)}">Edit</button>`
        : `<button class="btn secondary" type="button" disabled>Edit</button>`;
      const remove = ["cloud", "local"].includes(item.source)
        ? `<button class="btn danger" type="button" data-re-delete-deliverable="${escapeHtml(item.id)}">Delete</button>`
        : `<button class="btn secondary" type="button" disabled>Delete</button>`;
      return `
        <article class="real-estate-deliverable">
          <div>
            <strong>${escapeHtml(item.title)}</strong>
            <span>${escapeHtml(meta || item.label)}</span>
          </div>
          <div class="real-estate-deliverable-actions">
            ${edit}
            ${view}
            ${download}
            ${remove}
          </div>
        </article>
      `;
    }).join("");
    syncFileActionLabels();
  };

  const albumSelectedCount = (slug) => selectedPhotos()
    .filter((photo) => selectedProjectIdsFor(photo).includes(slug))
    .length;

  const renderAlbums = () => {
    if (!elements.albums) return;
    elements.albums.innerHTML = state.albums.length ? state.albums.map((album) => `
        <button class="real-estate-album-filter ${state.album === album.slug ? "is-active" : ""}" type="button" data-album-filter="${escapeHtml(album.slug)}" aria-pressed="${state.album === album.slug}">
          <span>${escapeHtml(album.displayTitle || album.title)}</span>
          <small>${Number(album.photoCount) || 0} property media / ${albumSelectedCount(album.slug)} selected</small>
          <b>Choose property</b>
        </button>
      `).join("") : `<p class="real-estate-muted">No properties are available yet.</p>`;
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
      const originalProperty = photo.albumSlug === activeProjectId() ? "" : albumTitleFor(photo);
      return `
        <article class="real-estate-photo-card ${selected ? "is-selected" : ""} ${video ? "is-video" : ""}" data-photo-id="${escapeHtml(photo.id)}">
          <div class="real-estate-photo-media-shell">
            <button class="real-estate-photo-media" type="button" data-open-photo="${escapeHtml(photo.id)}" aria-label="Open ${escapeHtml(titleFor(photo))}">
              <img loading="lazy" src="${escapeHtml(imageFor(photo))}" alt="${escapeHtml(titleFor(photo))}"/>
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
    if (elements.selectedTotal) elements.selectedTotal.textContent = String(selectedPhotos.length);
    if (elements.actionBarSelected) elements.actionBarSelected.textContent = String(selectedPhotos.length);
    if (elements.draftCount) elements.draftCount.textContent = String(selectedPhotos.length);
    if (!elements.draftList) return;
    elements.draftList.innerHTML = selectedPhotos.length ? selectedPhotos.map((photo, index) => `
      <article class="real-estate-draft-item ${isVideo(photo) ? "is-video" : ""}" data-draft-photo="${escapeHtml(photo.id)}" aria-label="Drag ${escapeHtml(titleFor(photo))} to reorder selection">
        <span class="real-estate-draft-handle" data-draft-drag-handle aria-hidden="true" title="Drag to reorder">
          <span aria-hidden="true"></span>
        </span>
        <strong class="real-estate-draft-position">${index + 1}</strong>
        <img src="${escapeHtml(imageFor(photo))}" alt="" draggable="false"/>
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
    `).join("") : `<p class="real-estate-muted">No selected media yet.</p>`;
  };

  const activeOutputSummary = () => state.albums
    .map((album) => ({ title: album.displayTitle || album.title, count: albumSelectedCount(album.slug) }))
    .filter((item) => item.count > 0)
    .map((item) => `${item.title}: ${item.count}`)
    .join(" / ");

  const stepCopy = () => {
    const selected = activeSelectedPhotos().length;
    if (state.wizardStep === 0) return "Choose the property you want to prepare.";
    if (state.wizardStep === 1) return `Click media to select it for ${selectedPropertyTitle()}. Shift-click selects a range.`;
    if (state.wizardStep === 2) return selected
      ? `Only the ${selected} selected media items are shown. Change titles only where needed.`
      : "Select at least one photo or video before editing titles.";
    if (state.wizardStep === 3) return selected
      ? `Drag the ${selected} selected media items into the order you want.`
      : "Select at least one photo or video before ordering.";
    return selected
      ? `Ready for output: ${activeOutputSummary() || `${selected} selected media`}. Choose PDF, video, or both.`
      : "Select at least one photo or video before creating outputs.";
  };

  const renderWizard = () => {
    const selected = activeSelectedPhotos().length;
    const firstStep = firstWizardStep();
    app.dataset.reStep = String(state.wizardStep);
    if (elements.wizardStatus) elements.wizardStatus.textContent = stepCopy();
    document.querySelectorAll("[data-re-step-jump]").forEach((button) => {
      const parsed = Number(button.dataset.reStepJump);
      const step = Number.isFinite(parsed) ? parsed : firstStep;
      button.hidden = step === 0 && !hasPropertyPicker();
      button.classList.toggle("is-active", step === state.wizardStep);
      button.setAttribute("aria-current", step === state.wizardStep ? "step" : "false");
      button.disabled = step >= 2 && selected === 0;
    });
    document.querySelectorAll("[data-re-step-back]").forEach((button) => {
      button.disabled = state.wizardStep <= firstStep;
      button.hidden = state.wizardStep <= firstStep;
    });
    document.querySelectorAll("[data-re-step-next]").forEach((button) => {
      button.hidden = state.wizardStep >= 4;
      button.disabled = state.wizardStep >= 1 && state.wizardStep < 4 && selected === 0;
      button.textContent = state.wizardStep === 0 ? "Pick photos" : (state.wizardStep === 3 ? "Choose output" : "Next");
    });
    document.querySelectorAll("[data-re-open-outputs], [data-re-download-outputs]").forEach((button) => {
      button.hidden = state.wizardStep !== 4;
      button.disabled = selected === 0;
    });
  };

  const render = () => {
    document.body.dataset.realEstateDensity = state.density;
    if (elements.pdfFormat) elements.pdfFormat.value = paperFormatFor().key;
    if (elements.mediaType) elements.mediaType.value = state.mediaType;
    if (elements.slideshowPhotoSeconds) elements.slideshowPhotoSeconds.value = String(state.slideshowPhotoSeconds);
    syncAuthUi();
    renderAlbums();
    renderGrid();
    renderDraft();
    renderWizard();
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
    if (next >= 2 && activeSelectedPhotos().length === 0) {
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
    document.getElementById("real-estate-wizard")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const projectListForSelectionChange = (photoId, photo) => {
    const explicit = explicitProjectIdsFor(photoId);
    return state.selectedIds.has(photoId) ? selectedProjectIdsFor(photo) : explicit;
  };

  const applySelectionForPhotoIds = (photoIds, selected) => {
    const projectId = activeProjectId();
    photoIds.forEach((photoId) => {
      if (!state.photosById.has(photoId)) return;
      const photo = state.photosById.get(photoId);
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
    const clean = String(value || "").trim();
    const fallback = photo.editableTitle || photo.title || photo.id;
    if (!clean || clean === fallback) {
      delete state.editedTitles[photoId];
    } else {
      state.editedTitles[photoId] = clean;
    }
    persistTitles();
    renderDraft();
    const nextTitle = titleFor(photo);
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
    render();
  };

  const timestampId = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const selectedPhotos = () => state.selectedOrder.map((id) => state.photosById.get(id)).filter(Boolean);
  const selectedMediaSummary = (photos = selectedPhotos()) => ({
    photos: photos.filter((photo) => !isVideo(photo)).length,
    videos: photos.filter(isVideo).length,
  });
  const outputProjectIdsFor = (photo, activeOnly = false) => {
    if (activeOnly && state.album && state.album !== "all" && isSelectedForActiveProject(photo)) return [state.album];
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

  const batchItemsFor = (photos, project = null) => photos.map((photo, index) => ({
    photoId: photo.id,
    title: titleFor(photo),
    sortIndex: index + 1,
    mediaType: mediaTypeFor(photo),
    durationSeconds: isVideo(photo) ? durationSecondsFor(photo) : null,
    pdfTreatment: isVideo(photo) ? "still-from-video" : "photo",
    pdfStillPercent: isVideo(photo) ? videoStillPercentFor(photo) : null,
    slideshowDurationPolicy: isVideo(photo) ? "preserve-source-duration" : "fixed-photo-duration",
    slideshowDurationSeconds: isVideo(photo) ? durationSecondsFor(photo) : state.slideshowPhotoSeconds,
    transition: slideshowTransition,
    cloudSourceKey: isVideo(photo) ? photo?.cloudPdfSource?.sourceVideoPrivateKey || photo?.realEstate?.privateMasterKey || "" : photo?.cloudPdfSource?.publicKey || "",
    sourceVideoPrivateKey: isVideo(photo) ? photo?.cloudPdfSource?.sourceVideoPrivateKey || photo?.realEstate?.privateMasterKey || "" : "",
    sourceDurationSeconds: isVideo(photo) ? durationSecondsFor(photo) : null,
    publicStillKey: photo?.cloudPdfSource?.publicKey || photo?.media?.publicPreview?.detailKey || "",
    projectId: project?.projectId || projectIdFor(photo),
    projectTitle: project?.projectTitle || projectTitleFor(photo),
    projectIds: project ? [project.projectId] : assignedProjectIdsFor(photo),
  }));

  const buildBatchManifest = (photosOverride = selectedPhotos(), activeOnly = false) => {
    flushTitleInputs();
    const template = workflow().batchManifest?.template || {};
    const batchId = timestampId();
    const photos = photosOverride;
    const projects = projectGroupsFor(photos, activeOnly);
    const mediaSummary = selectedMediaSummary(photos);
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
        pageOrientation: "portrait",
        layout: "landscape-two-per-page-portrait-one-per-page",
        fitMode: "contain",
        videoTreatment: "still-from-video",
        videoStillPercent: 10,
        photoWatermark: pdfWatermarkText,
        photoWatermarkPlacement: "bottom-center",
        pageWatermark: pdfWatermarkText,
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
    const dateLabel = manifest.createdAt ? new Date(manifest.createdAt).toLocaleString() : "";
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

  const buildSlideshowManifest = (photosOverride = selectedPhotos(), activeOnly = false) => {
    const base = buildBatchManifest(photosOverride, activeOnly);
    const musicTrack = chooseSlideshowMusicTrack();
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

  const slideshowHtmlFor = (manifest) => {
    const rows = selectionRowsFor(manifest);
    const audioPolicy = manifest.slideshowSettings?.audioPolicy || {};
    const musicTrack = audioPolicy.musicTrack || null;
    const previewSourceVideoVolume = Number(audioPolicy.sourceVideoAudioLinearGain ?? sourceVideoAudioLinearGain);
    const previewMusicGainDb = Number(audioPolicy.musicGainDb ?? slideshowMusicGainDb);
    const slides = rows.map(({ projectTitle, item }) => {
      const photo = state.photosById.get(item.photoId);
      if (!photo) return null;
      const video = item.mediaType === "video" || isVideo(photo);
      const dimensions = pdfDimensionsFor(photo);
      return {
        projectTitle: projectTitle || item.projectTitle || "",
        title: item.title || titleFor(photo),
        mediaType: video ? "video" : "photo",
        imageUrl: imageFor(photo, "detail"),
        videoUrl: video ? videoPreviewFor(photo) : "",
        orientation: dimensions.height > dimensions.width ? "portrait" : "landscape",
        durationMs: Math.max(1000, Number(video ? item.durationSeconds : item.slideshowDurationSeconds || state.slideshowPhotoSeconds) * 1000 || state.slideshowPhotoSeconds * 1000),
        durationLabel: video ? (formatDuration(item.durationSeconds || durationSecondsFor(photo)) || "source duration") : `${item.slideshowDurationSeconds || state.slideshowPhotoSeconds}s`,
        source: item.cloudSourceKey || item.publicStillKey || item.photoId || "",
        effect: item.effect || randomKenBurnsEffect(),
      };
    }).filter(Boolean);
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
    const dateLabel = manifest.createdAt ? new Date(manifest.createdAt).toLocaleString() : "";
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
    main{min-height:100dvh;display:grid;grid-template-rows:minmax(0,1fr) auto}
    .stage{position:relative;display:grid;min-height:70dvh;background:#050505;place-items:center;overflow:hidden}
    .frame{position:absolute;inset:0;display:grid;place-items:center;background:#050505;overflow:hidden}
    .frame video{width:100%;height:100%;object-fit:contain;background:#050505}
    .photo-slide{position:absolute;inset:0;display:grid;place-items:center;overflow:hidden;background:#050505}
    .photo-slide img{display:block;width:100%;height:100%;background:transparent}
    .slide-backdrop{position:absolute;inset:0;object-fit:cover;filter:blur(24px);opacity:.48;transform:scale(1.1)}
    .slide-photo{position:relative;z-index:1;object-fit:contain;animation:kenBurns var(--slide-duration,4s) ease-in-out both;will-change:transform}
    @keyframes kenBurns{from{transform:scale(var(--start-scale,1.03)) translate(var(--start-x,0),var(--start-y,0))}to{transform:scale(var(--end-scale,1.1)) translate(var(--end-x,0),var(--end-y,0))}}
    .caption{position:absolute;left:clamp(14px,4vw,42px);right:clamp(14px,4vw,42px);bottom:clamp(14px,4vw,38px);display:flex;align-items:end;justify-content:space-between;gap:16px;text-shadow:0 2px 14px #000}
    .caption h1{max-width:820px;margin:0;font-size:clamp(1.8rem,5vw,4.8rem);line-height:.98}
    .caption p{margin:8px 0 0;color:#d7d7d7;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
    .watermark{position:absolute;left:0;right:0;bottom:8px;text-align:center;color:rgba(255,255,255,.52);font-size:.76rem;font-weight:700;text-shadow:0 1px 6px #000}
    .controls{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:8px;border-top:1px solid rgba(255,255,255,.14);background:#171717;padding:14px}
    button{min-height:42px;border:1px solid rgba(255,255,255,.2);border-radius:999px;background:#242424;color:#fff;padding:8px 18px;font:inherit;font-weight:800;cursor:pointer}
    button:hover{background:#303030}
    @media (max-width:700px){
      main{display:block;min-height:100dvh}
      .stage{min-height:calc(100dvh - 70px)}
      .photo-slide{padding:calc(env(safe-area-inset-top,0px) + 12px) 12px clamp(132px,24dvh,190px)}
      .frame video{padding:calc(env(safe-area-inset-top,0px) + 12px) 12px clamp(132px,24dvh,190px)}
      .caption{bottom:clamp(18px,5dvh,48px)}
      .caption h1{font-size:clamp(1.35rem,8vw,2.5rem)}
      .caption p{font-size:.78rem}
      .controls{position:sticky;bottom:0;z-index:5;padding:10px calc(10px + env(safe-area-inset-right,0px)) calc(10px + env(safe-area-inset-bottom,0px)) calc(10px + env(safe-area-inset-left,0px))}
      button{min-height:38px;padding:7px 14px}
    }
    .meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;width:min(1120px,100%);margin:0 auto;padding:16px}
    .meta div{border:1px solid rgba(255,255,255,.14);background:#141414;padding:10px}
    .meta dt{color:#aaa;font-size:.72rem;font-weight:850;letter-spacing:.08em;text-transform:uppercase}
    .meta dd{margin:4px 0 0;font-weight:850}
    table{width:min(1120px,calc(100% - 32px));border-collapse:collapse;margin:0 auto 22px;font-size:.9rem;color:#e8e8e8}
    th,td{border:1px solid rgba(255,255,255,.14);padding:8px;text-align:left;vertical-align:top}
    th{font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:#aaa}
    code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.86em}
    .note{width:min(1120px,calc(100% - 32px));margin:0 auto 22px;color:#aaa;font-size:.9rem}
  </style>
</head>
<body>
  <main>
    <section class="stage" aria-label="Browser video preview">
      <div class="frame" data-frame></div>
      ${musicTrack?.absoluteSrc || musicTrack?.src ? `<audio data-music preload="auto" loop src="${escapeHtml(musicTrack.absoluteSrc || musicTrack.src)}"></audio>` : ""}
      <div class="caption">
        <div>
          <p data-project>${escapeHtml(slides[0]?.projectTitle || manifest.customer || "Client")}</p>
          <h1 data-title>${escapeHtml(slides[0]?.title || "Photos By Elie slideshow")}</h1>
        </div>
        <strong data-counter>${slides.length ? `1 / ${slides.length}` : "0 / 0"}</strong>
      </div>
      <div class="watermark">${escapeHtml(pdfWatermarkText)}</div>
    </section>
    <div class="controls">
      <button type="button" data-prev>Previous</button>
      <button type="button" data-play>${musicTrack?.absoluteSrc || musicTrack?.src ? "Play with sound" : "Pause"}</button>
      <button type="button" data-next>Next</button>
    </div>
    <dl class="meta">
      <div><dt>Batch</dt><dd><code>${escapeHtml(manifest.batchId || "")}</code></dd></div>
      <div><dt>Created</dt><dd>${escapeHtml(dateLabel)}</dd></div>
      <div><dt>Photo duration</dt><dd>${escapeHtml(manifest.slideshowSettings?.photoDurationSeconds || state.slideshowPhotoSeconds)}s</dd></div>
      <div><dt>Music</dt><dd>${escapeHtml(musicTrack?.title || "Random single-guitar cue")}</dd></div>
      <div><dt>Source audio</dt><dd>${escapeHtml(`${audioPolicy.sourceVideoAudioGainDb ?? sourceVideoAudioGainDb} dB`)}</dd></div>
      <div><dt>Transition</dt><dd>Random Ken Burns</dd></div>
    </dl>
    <table>
      <thead>
        <tr>
          <th>Project</th>
          <th>Order</th>
          <th>Type</th>
          <th>Duration</th>
          <th>Title</th>
          <th>Source</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(({ projectTitle, item }) => `
        <tr>
          <td>${escapeHtml(projectTitle || item.projectTitle || "")}</td>
          <td>${escapeHtml(item.sortIndex || "")}</td>
          <td>${escapeHtml(item.mediaType || "photo")}</td>
          <td>${escapeHtml(item.mediaType === "video" ? `preserve source${formatDuration(item.durationSeconds) ? ` (${formatDuration(item.durationSeconds)})` : ""}` : `${item.durationSeconds || state.slideshowPhotoSeconds}s`)}</td>
          <td>${escapeHtml(item.title || "")}</td>
          <td><code>${escapeHtml(item.cloudSourceKey || item.publicStillKey || item.photoId || "")}</code></td>
        </tr>`).join("")}
      </tbody>
    </table>
    <p class="note">This browser preview preserves source duration for videos when the browser can play them. Video source audio plays at ${escapeHtml(audioPolicy.sourceVideoAudioGainDb ?? sourceVideoAudioGainDb)} dB under the generated music. Photos use ${escapeHtml(state.slideshowPhotoSeconds)} seconds with portrait-safe Ken Burns motion.</p>
    <script type="application/json" data-re-selection-batch>${safeJson}</script>
    <script>
      const slides = ${safeSlidesJson};
      const musicTrack = ${safeMusicJson};
      const frame = document.querySelector("[data-frame]");
      const music = document.querySelector("[data-music]");
      const title = document.querySelector("[data-title]");
      const project = document.querySelector("[data-project]");
      const counter = document.querySelector("[data-counter]");
      const playButton = document.querySelector("[data-play]");
      let index = 0;
      let timer = 0;
      let playing = true;
      let soundBlocked = Boolean(music);
      const sourceVideoVolume = Math.min(1, Math.max(0, ${Number(previewSourceVideoVolume).toFixed(4)}));
      const musicVolume = Math.pow(10, Number(musicTrack?.musicGainDb ?? ${previewMusicGainDb}) / 20);
      const attr = (value) => String(value || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const effectStyle = (effect, durationMs) => {
        const presets = {
          "slow-zoom-in": [1.005, 1.045, "0%", "0%", "0%", "0%"],
          "slow-zoom-out": [1.045, 1.01, "0%", "0%", "0%", "0%"],
          "pan-left": [1.03, 1.04, "1.1%", "0%", "-1.1%", "0%"],
          "pan-right": [1.03, 1.04, "-1.1%", "0%", "1.1%", "0%"],
          "rise-up": [1.025, 1.04, "0%", "0.9%", "0%", "-0.9%"],
          "drift-down": [1.025, 1.04, "0%", "-0.9%", "0%", "0.9%"],
        };
        const [startScale, endScale, startX, startY, endX, endY] = presets[effect] || presets["slow-zoom-in"];
        return "--slide-duration:" + durationMs + "ms;--start-scale:" + startScale + ";--end-scale:" + endScale + ";--start-x:" + startX + ";--start-y:" + startY + ";--end-x:" + endX + ";--end-y:" + endY;
      };
      const photoSlideHtml = (slide) => {
        const source = attr(slide.imageUrl);
        const style = attr(effectStyle(slide.effect, Math.max(1000, slide.durationMs || 4000)));
        const orientation = slide.orientation === "portrait" ? "portrait" : "landscape";
        return '<div class="photo-slide is-' + orientation + '"><img class="slide-backdrop" aria-hidden="true" alt="" src="' + source + '"><img class="slide-photo" alt="" style="' + style + '" src="' + source + '"></div>';
      };

      const clearTimer = () => {
        if (timer) window.clearTimeout(timer);
        timer = 0;
      };
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
        if (music) music.pause();
      };
      const render = () => {
        clearTimer();
        const slide = slides[index];
        if (!slide) {
          frame.innerHTML = "";
          title.textContent = "No media selected";
          project.textContent = "";
          counter.textContent = "0 / 0";
          return;
        }
        title.textContent = slide.title || "Untitled";
        project.textContent = slide.projectTitle || slide.mediaType || "";
        counter.textContent = (index + 1) + " / " + slides.length;
        if (playing) playMusic();
        if (slide.mediaType === "video" && slide.videoUrl) {
          frame.innerHTML = '<video controls playsinline poster="' + attr(slide.imageUrl) + '" src="' + attr(slide.videoUrl) + '"></video>';
          const video = frame.querySelector("video");
          video.volume = sourceVideoVolume;
          video.addEventListener("ended", () => playing && next());
          video.addEventListener("error", () => {
            frame.innerHTML = photoSlideHtml(slide);
            if (playing) timer = window.setTimeout(next, Math.max(1000, slide.durationMs || 4000));
          });
          if (playing) video.play().catch(() => {});
        } else {
          frame.innerHTML = photoSlideHtml(slide);
          if (playing) timer = window.setTimeout(next, Math.max(1000, slide.durationMs || 4000));
        }
      };
      const next = () => {
        index = slides.length ? (index + 1) % slides.length : 0;
        render();
      };
      const prev = () => {
        index = slides.length ? (index - 1 + slides.length) % slides.length : 0;
        render();
      };
      document.querySelector("[data-next]")?.addEventListener("click", next);
      document.querySelector("[data-prev]")?.addEventListener("click", prev);
      playButton?.addEventListener("click", async () => {
        if (soundBlocked) {
          playing = true;
          await playMusic();
          const video = frame.querySelector("video");
          if (video) video.play().catch(() => {});
          render();
          return;
        }
        playing = !playing;
        syncPlayButton();
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
      setStatus("Clipboard unavailable; use Share selection table");
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

  const shareOrOpenBlob = async ({ blob, filename, title, text, openFallback = true }) => {
    const canCreateFile = typeof File === "function";
    const file = canCreateFile ? new File([blob], filename, { type: blob.type || "text/html" }) : null;
    if (file && navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({
          title,
          text,
          files: [file],
        });
        return { method: "share", filename, bytes: Number(blob.size) || 0 };
      } catch (error) {
        if (error?.name === "AbortError") throw error;
      }
    }

    if (openFallback) {
      const url = URL.createObjectURL(blob);
      const opened = window.open(url, "_blank", "noopener");
      if (opened) {
        window.setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000);
        return { method: "open", filename, bytes: Number(blob.size) || 0 };
      }
      URL.revokeObjectURL(url);
    }
    return { method: "download", ...(await downloadBlob(blob, filename)) };
  };

  const shareSelectionTable = async () => {
    if (!requireUnlocked() || state.outputBusy) return;
    const batch = buildBatchManifest(activeSelectedPhotos(), true);
    if (!batch.items?.length) {
      setStatus("Select media before sharing a selection table");
      return;
    }
    startOutputProgress({
      title: "Preparing selection table",
      detail: "Building the shareable selection file...",
      total: 2,
      kind: "selection",
    });
    updateOutputProgress({
      title: "Preparing selection table",
      detail: "Formatting selected media...",
      current: 1,
      total: 2,
    });
    try {
      const blob = new Blob([selectionHtmlFor(batch)], { type: "text/html" });
      const filename = `${state.gallery?.key || "real-estate"}-${batch.batchId}-selection.html`;
      const saved = await shareOrOpenBlob({
        blob,
        filename,
        title: "Photos By Elie selection",
        text: `${batch.customer || "Client"} selection table`,
      });
      if (saved.method === "share") {
        setStatus(`Shared ${saved.filename} (${formatBytes(saved.bytes)})`);
      } else if (saved.method === "open") {
        setStatus(`Opened ${saved.filename}; use the browser share or save controls`);
      } else {
        setStatus(`Downloaded ${saved.filename} to Downloads (${formatBytes(saved.bytes)})`);
      }
      completeOutputProgress(`Ready: ${saved.filename} (${formatBytes(saved.bytes)})`);
    } catch (error) {
      const message = error?.name === "AbortError" ? "Share canceled" : "Selection table could not be shared";
      setStatus(message);
      failOutputProgress(message);
    }
  };

  const shareSlideshowPlan = async ({ mode = "download", reservedWindow = null, recordProduct = true, progressKind = "" } = {}) => {
    if (!requireUnlocked() || state.outputBusy) return;
    const selected = activeSelectedPhotos();
    if (!selected.length) {
      setStatus(`Select media before ${mode === "view" ? "viewing" : "downloading"} a video output`);
      return;
    }
    const openInBrowser = mode === "view" || shouldOpenHtmlVideoDownloadsInBrowser();
    const title = openInBrowser ? "Preparing video view" : "Preparing video download";
    startOutputProgress({
      title,
      detail: "Building slideshow manifest...",
      total: 3,
      kind: progressKind || (mode === "view" ? "video-view" : "video-download"),
    });
    try {
      const batch = buildSlideshowManifest(selected, true);
      updateOutputProgress({ title, detail: "Adding music and Ken Burns motion...", current: 1, total: 3 });
      const filename = `${state.gallery?.key || "real-estate"}-${batch.batchId}-slideshow.html`;
      if (recordProduct) saveLocalDeliverable({ type: "video", batch, filename });
      const html = slideshowHtmlFor(batch);
      updateOutputProgress({
        title,
        detail: openInBrowser ? "Opening browser video view..." : "Sending video file to Downloads...",
        current: 2,
        total: 3,
      });
      const saved = openInBrowser
        ? await openHtmlInBrowser(html, filename, reservedWindow || reserveOutputWindow("Building video preview"))
        : { method: "download", ...(await downloadBlob(new Blob([html], { type: "text/html" }), filename)) };
      if (recordProduct) saveLocalDeliverable({ type: "video", batch, filename: saved.filename, bytes: saved.bytes });
      if (saved.method === "open" || saved.method === "open-current") {
        setStatus(`Viewing ${saved.filename}. ${deliverableActionNote}`);
      } else {
        setStatus(`Downloaded ${saved.filename} to Downloads (${formatBytes(saved.bytes)})`);
      }
      completeOutputProgress(`Ready: ${saved.filename} (${formatBytes(saved.bytes)})`);
    } catch (error) {
      const message = error?.name === "AbortError" ? "Output canceled" : "Video output could not be prepared";
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
    let accessCode = state.accessCode || saved.accessCode || "";
    if (!accessCode || message) {
      accessCode = await promptOriginalsPassword(message);
    }
    writeSessionCredentials(username, accessCode);
    return { username, accessCode };
  };

  const requestOriginalsSession = async (photos, passwordMessage = "") => {
    const baseUrl = workerBaseUrl();
    if (!baseUrl) throw new Error("Originals ZIP needs the Photos By Elie Worker.");
    const credentials = await credentialsForOriginals(passwordMessage);
    const response = await fetch(`${baseUrl}/real-estate/originals/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        galleryKey: state.gallery?.key || "",
        username: credentials.username,
        accessCode: credentials.accessCode,
        items: originalRequestItemsFor(photos),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = body?.error?.message || "Originals ZIP could not be prepared.";
      const error = new Error(message);
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
      let session = null;
      let passwordMessage = "";
      for (let attempt = 0; attempt < 2 && !session; attempt += 1) {
        setStatus(`Preparing private original links for ${photos.length} selected media item${photos.length === 1 ? "" : "s"}...`);
        updateOutputProgress({
          title: "Preparing originals ZIP",
          detail: `Requesting private links for ${photos.length} selected media item${photos.length === 1 ? "" : "s"}...`,
        });
        try {
          session = await requestOriginalsSession(photos, passwordMessage);
        } catch (error) {
          if (error?.code === "real_estate_auth_required" && attempt === 0) {
            clearSessionCredentials();
            passwordMessage = "That password did not work. Enter the client password again.";
            setStatus("Password did not work; enter the client password again to create the originals ZIP");
            continue;
          }
          throw error;
        }
      }
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
      if (saved.method === "share") {
        setStatus(`Shared ${saved.filename} (${formatBytes(saved.bytes)})`);
      } else {
        setStatus(`Downloaded ${saved.filename} to Downloads (${formatBytes(saved.bytes)})`);
      }
      completeOutputProgress(`Ready: ${saved.filename} (${formatBytes(saved.bytes)})`);
    } catch (error) {
      const message = error?.name === "AbortError" ? "Originals ZIP canceled" : (error?.message || "Originals ZIP failed");
      setStatus(message);
      failOutputProgress(message);
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

  const imagePlacement = (dimensions, box) => {
    const scale = Math.min(box.width / dimensions.width, box.height / dimensions.height);
    const width = dimensions.width * scale;
    const height = dimensions.height * scale;
    return {
      width,
      height,
      x: box.x + ((box.width - width) / 2),
      y: box.y + ((box.height - height) / 2),
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

  const renderPdfPages = async (images, onProgress = null) => {
    const pages = paginatePdfImages(images);
    const paper = paperFormatFor();
    const pageWidth = paper.width;
    const pageHeight = paper.height;
    const margin = 30;
    const titleArea = 28;
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

      const slotHeight = page.layout === "two-up-landscape"
        ? ((pageHeight - (margin * 2) - rowGap) / 2)
        : (pageHeight - (margin * 2));
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
            y: slot.y + titleArea,
            width: slot.width,
            height: Math.max(1, slot.height - titleArea),
          };
          const placement = imagePlacement(naturalDimensions, imageBox);
          context.fillStyle = "#111111";
          context.font = "700 12px Arial, Helvetica, sans-serif";
          context.textAlign = "left";
          context.textBaseline = "middle";
          context.fillText(
            fittedCanvasText(context, item.title || titleFor(item.photo), slot.width),
            slot.x,
            slot.y + 13
          );
          context.drawImage(loaded.image, placement.x, placement.y, placement.width, placement.height);

          const watermarkFontSize = Math.max(8, Math.min(12, placement.width / 48));
          context.font = `700 ${watermarkFontSize}px Arial, Helvetica, sans-serif`;
          context.textAlign = "center";
          context.textBaseline = "alphabetic";
          const photoWatermark = fittedCanvasText(context, pdfWatermarkText, placement.width - 18);
          const watermarkY = placement.y + placement.height - Math.max(8, watermarkFontSize * 0.8);
          context.fillStyle = "rgba(0, 0, 0, 0.38)";
          drawCenteredCanvasText(context, photoWatermark, placement.x + 1, watermarkY + 1, placement.width);
          context.fillStyle = "rgba(255, 255, 255, 0.70)";
          drawCenteredCanvasText(context, photoWatermark, placement.x, watermarkY, placement.width);
        } finally {
          loaded.cleanup();
        }
      }

      context.font = "700 8px Arial, Helvetica, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "alphabetic";
      context.fillStyle = "rgba(0, 0, 0, 0.42)";
      context.fillText(pdfWatermarkText, pageWidth / 2, pageHeight - 10);

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
    let nextId = 3;
    const { pageWidth, pageHeight } = rendered;

    setObject(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);

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
      const content = `q\n${pageWidth.toFixed(2)} 0 0 ${pageHeight.toFixed(2)} 0 0 cm\n/${imageName} Do\nQ\n`;
      setObject(contentId, [
        `<< /Length ${encoder.encode(content).byteLength} >>\nstream\n`,
        content,
        "endstream",
      ]);
      setObject(pageId, [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}] /Resources << /XObject << /${imageName} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
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
      setStatus(`Select media before ${mode === "view" ? "viewing" : "downloading"} project PDFs`);
      return;
    }
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
    const wantsPdf = elements.outputPdf?.checked !== false;
    const wantsVideo = Boolean(elements.outputVideo?.checked);
    if (!wantsPdf && !wantsVideo) {
      setStatus("Choose PDF, video, or both");
      return;
    }
    const pdfWindow = mode === "view" && wantsPdf ? reserveOutputWindow("Building PDF") : null;
    const videoWindow = mode === "view" && wantsVideo ? reserveOutputWindow("Building video preview") : null;
    const progressKind = mode === "view" ? "outputs-view" : "outputs-download";
    if (wantsPdf) await downloadPdf({ mode, reservedWindows: pdfWindow ? [pdfWindow] : [], progressKind });
    if (wantsVideo) await shareSlideshowPlan({ mode, reservedWindow: videoWindow, progressKind });
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

  const startNewProduct = () => {
    if (!requireUnlocked()) return;
    state.selectedOrder = [];
    state.selectedIds = new Set();
    state.projectAssignments = {};
    state.selectedOnly = false;
    state.album = defaultAlbumSlug();
    persistSelection();
    persistProjectAssignments();
    setWizardStep(firstWizardStep());
    document.querySelector("#real-estate-wizard")?.scrollIntoView({ behavior: "smooth", block: "start" });
    setStatus("Started a new product. Choose media, edit titles, reorder, then view or download outputs.");
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
    persistSelection();
    persistTitles();
    persistProjectAssignments();
    if (editMode) state.wizardStep = 3;
    render();
    setStatus(`${statusPrefix} ${activeSelectedPhotos().length} selected media for ${selectedPropertyTitle()}${editMode ? "; use Photos to add or remove media, and Order to reorder" : ""}`);
  };

  const deliverableBatchFor = async (item) => {
    if (item?.batch) return item.batch;
    const response = await fetch(item.editUrl);
    if (!response.ok) throw new Error(`Could not load product manifest (${response.status})`);
    return parseBatchFileText(await response.text());
  };

  const editProducedDeliverable = async (deliverableId) => {
    if (!requireUnlocked()) return;
    const item = producedDeliverables().find((deliverable) => deliverable.id === deliverableId);
    if (!item) return;
    try {
      setStatus(`Loading ${item.title} for editing...`);
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
      const openInBrowser = mode === "view" || shouldOpenHtmlVideoDownloadsInBrowser();
      const title = openInBrowser ? "Preparing video view" : "Preparing video download";
      startOutputProgress({
        title,
        detail: "Loading saved video product...",
        total: 2,
        kind: mode === "view" ? "video-view" : "video-download",
      });
      const html = slideshowHtmlFor(batch);
      const filename = `${state.gallery?.key || "real-estate"}-${batch.batchId || timestampId()}-slideshow.html`;
      updateOutputProgress({
        title,
        detail: openInBrowser ? "Opening saved video view..." : "Sending saved video file to Downloads...",
        current: 1,
        total: 2,
      });
      const saved = openInBrowser
        ? await openHtmlInBrowser(html, filename, reserveOutputWindow("Building video preview"))
        : { method: "download", ...(await downloadBlob(new Blob([html], { type: "text/html" }), filename)) };
      if (saved.method === "open" || saved.method === "open-current") {
        setStatus(`Viewing ${saved.filename}. ${deliverableActionNote}`);
      } else {
        setStatus(`Downloaded ${saved.filename} to Downloads (${formatBytes(saved.bytes)})`);
      }
      completeOutputProgress(`Ready: ${saved.filename} (${formatBytes(saved.bytes)})`);
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

    elements.loginForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const enteredUser = normalizeCredential(elements.loginName?.value);
      const enteredCode = normalizeCredential(elements.loginCode?.value);
      if (!await credentialMatches(enteredUser, enteredCode)) {
        if (elements.loginStatus) elements.loginStatus.textContent = "Credentials do not match this review.";
        return;
      }
      state.unlocked = true;
      writeSessionCredentials(elements.loginName?.value || "", elements.loginCode?.value || "");
      writeSession(elements.loginName?.value || "", elements.loginCode?.value || "");
      clearLogoutFromHistory();
      syncAuthUi();
      setStatus(`${state.photos.length} visible / ${state.photos.length} media`);
      fetchCloudDeliverables({ quiet: true }).catch(() => {});
      window.setTimeout(() => showHelp(), 120);
    });

    elements.albums?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-album-filter]");
      if (!button) return;
      if (!requireUnlocked()) return;
      state.album = button.dataset.albumFilter || "all";
      state.wizardStep = 1;
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
    elements.density?.addEventListener("change", (event) => {
      state.density = event.target.value;
      localStorage.setItem(densityKey, state.density);
      renderGrid();
    });
    elements.pdfFormat?.addEventListener("change", (event) => {
      state.pdfFormat = paperFormatFor(event.target.value).key;
      localStorage.setItem(pdfFormatKey, state.pdfFormat);
      event.target.value = state.pdfFormat;
    });
    elements.slideshowPhotoSeconds?.addEventListener("change", (event) => {
      const next = Math.max(1, Math.min(30, Math.round(Number(event.target.value) || 4)));
      state.slideshowPhotoSeconds = next;
      localStorage.setItem(slideshowPhotoSecondsKey, String(next));
      event.target.value = String(next);
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
    document.querySelectorAll("[data-re-open-outputs]").forEach((button) => button.addEventListener("click", () => {
      openSelectedOutputs().catch(() => setStatus("Outputs could not be opened"));
    }));
    document.querySelectorAll("[data-re-download-outputs]").forEach((button) => button.addEventListener("click", () => {
      downloadSelectedOutputs().catch(() => setStatus("Outputs could not be downloaded"));
    }));
    document.querySelectorAll("[data-re-create-product]").forEach((button) => button.addEventListener("click", startNewProduct));
    document.querySelectorAll("[data-re-copy-batch]").forEach((button) => button.addEventListener("click", copyBatch));
    document.querySelectorAll("[data-re-download-batch]").forEach((button) => button.addEventListener("click", () => {
      shareSelectionTable().catch(() => setStatus("Selection table could not be shared"));
    }));
    document.querySelectorAll("[data-re-view-slideshow]").forEach((button) => button.addEventListener("click", () => {
      shareSlideshowPlan({ mode: "view" }).catch(() => setStatus("Video output could not be viewed"));
    }));
    document.querySelectorAll("[data-re-download-slideshow]").forEach((button) => button.addEventListener("click", () => {
      shareSlideshowPlan({ mode: "download" }).catch(() => setStatus("Video output could not be downloaded"));
    }));
    document.querySelectorAll("[data-re-download-originals]").forEach((button) => button.addEventListener("click", () => {
      shareOriginalsZip().catch(() => setStatus("Originals ZIP failed"));
    }));
    document.querySelectorAll("[data-re-view-pdf]").forEach((button) => button.addEventListener("click", () => downloadPdf({ mode: "view" })));
    document.querySelectorAll("[data-re-download-pdf]").forEach((button) => button.addEventListener("click", () => downloadPdf({ mode: "download" })));
    elements.deliverablesList?.addEventListener("click", (event) => {
      const button = event.target?.closest?.("[data-re-edit-deliverable], [data-re-view-deliverable], [data-re-download-deliverable], [data-re-delete-deliverable], [data-re-sync-deliverables]");
      if (!button) return;
      if (button.matches("[data-re-sync-deliverables]")) {
        fetchCloudDeliverables({ promptIfMissing: true, quiet: false }).catch(() => {});
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
    document.querySelectorAll("[data-re-logout]").forEach((button) => button.addEventListener("click", () => {
      localStorage.removeItem(authStoreKey());
      clearSessionCredentials();
      state.unlocked = false;
      syncAuthUi();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }));
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
      writeJson(helpDismissedKey(), true);
    });
    document.addEventListener("keydown", (event) => {
      if (!elements.dialog?.open) return;
      if (event.key === "ArrowLeft") stepDialog(-1);
      if (event.key === "ArrowRight") stepDialog(1);
    });
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
    state.wizardStep = firstWizardStep();
    state.selectedOrder = normalizeSelectedOrder(readJson(selectionStoreKey(), []));
    state.selectedIds = new Set(state.selectedOrder);
    state.editedTitles = readJson(titleStoreKey(), {});
    state.projectAssignments = readJson(projectStoreKey(), {});
    const savedDeliverables = readJson(localDeliverablesStoreKey(), []);
    state.localDeliverables = Array.isArray(savedDeliverables) ? savedDeliverables : [];
    if (pageParams.has("logout")) {
      localStorage.removeItem(authStoreKey());
      clearSessionCredentials();
    }
    state.unlocked = hasUnlockedSession();
    const savedCredentials = readSessionCredentials();
    const savedSession = readJson(authStoreKey(), {});
    state.username = savedCredentials.username || savedSession.username || state.payload?.customer?.username || state.payload?.customer?.name || "";
    state.accessCode = savedCredentials.accessCode || savedSession.accessCode || "";
    if (elements.density) elements.density.value = state.density;
    state.pdfFormat = paperFormatFor(state.pdfFormat).key;
    if (elements.pdfFormat) elements.pdfFormat.value = state.pdfFormat;
    renderHero();
    render();
    if (state.unlocked) fetchCloudDeliverables({ quiet: true }).catch(() => {});
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
    if (initialized) window.setTimeout(() => showHelp(), 160);
  };

  initialize();
})();
