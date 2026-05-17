(() => {
  const app = document.querySelector("[data-real-estate-app]");
  if (!app) return;

  const pageParams = new URLSearchParams(window.location.search);
  const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
  const pageVersion = pageParams.get("v");
  const defaultLocalContext = `./tmp/real-estate-import/corine/app-context.js${pageVersion ? `?v=${encodeURIComponent(pageVersion)}` : ""}`;
  const defaultPublicContext = `./assets/real-estate/corine/app-context.js${pageVersion ? `?v=${encodeURIComponent(pageVersion)}` : ""}`;
  const contextParam = pageParams.get("context");
  const contextUrl = contextParam || (isLocalHost ? defaultLocalContext : defaultPublicContext);
  const densityKey = "photosbyelie-real-estate-card-density";
  const pdfFormatKey = "photosbyelie-real-estate-pdf-format";

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
    total: app.querySelector("[data-re-total]"),
    albumTotal: app.querySelector("[data-re-album-total]"),
    selectedTotal: app.querySelector("[data-re-selected-total]"),
    albums: app.querySelector("[data-re-albums]"),
    filterForm: app.querySelector("[data-re-filter-form]"),
    search: app.querySelector("[data-re-search]"),
    sort: app.querySelector("[data-re-sort]"),
    density: app.querySelector("[data-re-density]"),
    mediaType: app.querySelector("[data-re-media-type]"),
    selectedOnly: app.querySelector("[data-re-selected-only]"),
    pdfFormat: app.querySelector("[data-re-pdf-format]"),
    status: app.querySelector("[data-re-status]"),
    draftCount: app.querySelector("[data-re-draft-count]"),
    draftList: app.querySelector("[data-re-draft-list]"),
    grid: app.querySelector("[data-re-grid]"),
    actionBarSelected: document.querySelector("[data-re-selected-bar]"),
    actionStatus: document.querySelector("[data-re-action-status]"),
    dialog: document.querySelector("[data-re-dialog]"),
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
  };

  const state = {
    payload: null,
    gallery: null,
    photos: [],
    photosById: new Map(),
    albums: [],
    album: "all",
    query: "",
    sort: "album",
    density: localStorage.getItem(densityKey) || "balanced",
    mediaType: "all",
    pdfFormat: localStorage.getItem(pdfFormatKey) || "a4",
    selectedOnly: false,
    selectedOrder: [],
    selectedIds: new Set(),
    editedTitles: {},
    projectAssignments: {},
    activePhotoId: "",
    dragDraftId: "",
    pointerDraftId: "",
    pointerDraftStartX: 0,
    pointerDraftStartY: 0,
    pointerDraftActive: false,
    unlocked: false,
    pdfBusy: false,
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
  const expectedUsername = () => normalizeCredential(
    state.payload?.customer?.username
    || state.payload?.customer?.name
    || ""
  );
  const expectedAccessCode = () => normalizeCredential(
    state.payload?.accessCode
    || state.payload?.customer?.accessCode
    || ""
  );

  const hasUnlockedSession = () => {
    const saved = readJson(authStoreKey(), {});
    return Boolean(
      saved?.unlocked
      && saved?.galleryKey === state.gallery?.key
      && normalizeCredential(saved?.username) === expectedUsername()
    );
  };

  const writeSession = (username = "") => writeJson(authStoreKey(), {
    galleryKey: state.gallery?.key || "",
    username,
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

  const titleFor = (photo) => state.editedTitles[photo?.id] || photo?.editableTitle || photo?.title || photo?.id || "";
  const albumTitleFor = (photo) => photo?.albumTitle || photo?.caption || photo?.album || "Property";
  const mediaTypeFor = (photo) => {
    const rawType = String(
      photo?.media?.type
      || photo?.mediaType
      || photo?.type
      || photo?.kind
      || ""
    ).toLowerCase();
    return rawType.includes("video") ? "video" : "photo";
  };
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
  const photoSearchText = (photo) => [
    titleFor(photo),
    photo?.title,
    photo?.full,
    photo?.id,
    photo?.album,
    photo?.albumTitle,
    photo?.caption,
    mediaTypeFor(photo),
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

  const filteredPhotos = () => {
    const query = state.query.trim().toLowerCase();
    const selectedRank = new Map(state.selectedOrder.map((id, index) => [id, index]));
    const photos = state.photos.filter((photo) => {
      if (state.album !== "all" && photo.albumSlug !== state.album) return false;
      if (state.mediaType !== "all" && mediaTypeFor(photo) !== state.mediaType) return false;
      if (state.selectedOnly && !state.selectedIds.has(photo.id)) return false;
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
  const formatBytes = (bytes) => {
    const value = Number(bytes) || 0;
    if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
    if (value >= 1024) return `${Math.round(value / 1024)} KB`;
    return `${value} bytes`;
  };

  const syncFileActionLabels = () => {
    document.querySelectorAll("[data-re-download-pdf]").forEach((button) => {
      button.textContent = "Download project PDFs";
      button.title = "Browser will save project PDFs to your Downloads folder";
    });
    document.querySelectorAll("[data-re-download-batch]").forEach((button) => {
      button.textContent = "Share selection table";
      button.title = "Open or share an HTML table that can be loaded back later";
    });
    document.querySelectorAll("[data-re-download-originals]").forEach((button) => {
      button.textContent = state.originalsBusy ? "Building originals ZIP..." : "Share originals ZIP";
      button.title = "Prepare a ZIP of selected original JPG files from private delivery storage";
      button.disabled = state.originalsBusy;
    });
    document.querySelectorAll("[data-re-load-batch]").forEach((button) => {
      button.textContent = "Load selection file...";
      button.title = "Open a saved selection table or legacy JSON file";
    });
  };

  const renderHero = () => {
    const { gallery, payload, photos } = state;
    const albums = state.albums;
    if (elements.loginCustomer) elements.loginCustomer.textContent = "Private client access";
    if (elements.customer) elements.customer.textContent = payload?.customer?.name ? `${payload.customer.name} review` : "Client review";
    if (elements.title) elements.title.textContent = gallery?.title || "Real estate selection";
    if (elements.description) elements.description.textContent = gallery?.description || "Private photo review workspace for property PDF delivery.";
    if (elements.total) elements.total.textContent = String(photos.length);
    if (elements.albumTotal) elements.albumTotal.textContent = String(albums.length);
  };

  const albumSelectedCount = (slug) => state.photos
    .filter((photo) => photo.albumSlug === slug && state.selectedIds.has(photo.id))
    .length;

  const renderAlbums = () => {
    if (!elements.albums) return;
    const allSelected = state.selectedOrder.length;
    elements.albums.innerHTML = [
      `<button class="real-estate-album-filter ${state.album === "all" ? "is-active" : ""}" type="button" data-album-filter="all" aria-pressed="${state.album === "all"}">
        <span>All properties</span>
        <small>${state.photos.length} photos / ${allSelected} selected</small>
      </button>`,
      ...state.albums.map((album) => `
        <button class="real-estate-album-filter ${state.album === album.slug ? "is-active" : ""}" type="button" data-album-filter="${escapeHtml(album.slug)}" aria-pressed="${state.album === album.slug}">
          <span>${escapeHtml(album.displayTitle || album.title)}</span>
          <small>${Number(album.photoCount) || 0} photos / ${albumSelectedCount(album.slug)} selected</small>
        </button>
      `),
    ].join("");
  };

  const renderGrid = () => {
    if (!elements.grid) return;
    const photos = filteredPhotos();
    elements.grid.dataset.density = state.density;
    elements.grid.innerHTML = photos.length ? photos.map((photo) => {
      const selected = state.selectedIds.has(photo.id);
      const assignedProjects = new Set(assignedProjectIdsFor(photo));
      const mediaType = mediaTypeFor(photo);
      return `
        <article class="real-estate-photo-card ${selected ? "is-selected" : ""} is-${escapeHtml(mediaType)}" data-photo-id="${escapeHtml(photo.id)}" data-media-type="${escapeHtml(mediaType)}">
          <div class="real-estate-photo-media-shell">
            <button class="real-estate-photo-media" type="button" data-open-photo="${escapeHtml(photo.id)}" aria-label="Open ${escapeHtml(titleFor(photo))}">
              <img loading="lazy" src="${escapeHtml(imageFor(photo))}" alt="${escapeHtml(titleFor(photo))}"/>
              <span>${escapeHtml(albumTitleFor(photo))}</span>
              ${mediaType === "video" ? `<b class="real-estate-media-type-badge">Video</b>` : ""}
            </button>
            <label class="real-estate-check real-estate-photo-select">
              <input type="checkbox" data-select-photo="${escapeHtml(photo.id)}" aria-label="Select ${escapeHtml(titleFor(photo))} for PDF" ${selected ? "checked" : ""}/>
            </label>
          </div>
          <div class="real-estate-photo-card-body">
            <label class="real-estate-title-field">
              <input type="text" data-title-photo="${escapeHtml(photo.id)}" aria-label="PDF title for ${escapeHtml(titleFor(photo))}" value="${escapeHtml(titleFor(photo))}"/>
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
    setStatus(`${photos.length} visible / ${state.photos.length} photos`);
  };

  const renderDraft = () => {
    const selectedPhotos = state.selectedOrder.map((id) => state.photosById.get(id)).filter(Boolean);
    if (elements.selectedTotal) elements.selectedTotal.textContent = String(selectedPhotos.length);
    if (elements.actionBarSelected) elements.actionBarSelected.textContent = String(selectedPhotos.length);
    if (elements.draftCount) elements.draftCount.textContent = String(selectedPhotos.length);
    if (!elements.draftList) return;
    elements.draftList.innerHTML = selectedPhotos.length ? selectedPhotos.map((photo, index) => `
      <article class="real-estate-draft-item" data-draft-photo="${escapeHtml(photo.id)}" aria-label="Drag ${escapeHtml(titleFor(photo))} to reorder PDF draft">
        <span class="real-estate-draft-handle" data-draft-drag-handle aria-hidden="true" title="Drag to reorder">
          <span aria-hidden="true"></span>
        </span>
        <img src="${escapeHtml(imageFor(photo))}" alt="" draggable="false"/>
        <div>
          <strong>${escapeHtml(titleFor(photo))}</strong>
          <small>${escapeHtml(assignedProjectIdsFor(photo).map((projectId) => projectOptionFor(projectId, photo).projectTitle).join(" + "))}</small>
        </div>
        <div class="real-estate-draft-actions">
          <button type="button" data-move-draft="${escapeHtml(photo.id)}" data-direction="-1" aria-label="Move ${escapeHtml(titleFor(photo))} up">&uarr;</button>
          <button type="button" data-move-draft="${escapeHtml(photo.id)}" data-direction="1" aria-label="Move ${escapeHtml(titleFor(photo))} down">&darr;</button>
          <button type="button" data-remove-draft="${escapeHtml(photo.id)}" aria-label="Remove ${escapeHtml(titleFor(photo))}">&times;</button>
        </div>
        <span class="real-estate-draft-index">${index + 1}</span>
      </article>
    `).join("") : `<p class="real-estate-muted">No selected photos yet.</p>`;
  };

  const render = () => {
    document.body.dataset.realEstateDensity = state.density;
    if (elements.pdfFormat) elements.pdfFormat.value = paperFormatFor().key;
    if (elements.mediaType) elements.mediaType.value = state.mediaType;
    syncAuthUi();
    renderAlbums();
    renderGrid();
    renderDraft();
    syncFileActionLabels();
    window.photosByElieVersionInternalLinks?.(app);
  };

  const setSelected = (photoId, selected) => {
    if (!state.photosById.has(photoId)) return;
    if (selected && !state.selectedIds.has(photoId)) state.selectedOrder.push(photoId);
    if (!selected) state.selectedOrder = state.selectedOrder.filter((id) => id !== photoId);
    persistSelection();
    render();
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
    if (state.activePhotoId === photoId && elements.dialogTitle) elements.dialogTitle.textContent = titleFor(photo);
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
  const projectGroupsFor = (photos) => {
    const groups = new Map();
    photos.forEach((photo) => {
      assignedProjectIdsFor(photo).forEach((projectId) => {
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
    projectId: project?.projectId || projectIdFor(photo),
    projectTitle: project?.projectTitle || projectTitleFor(photo),
    projectIds: project ? [project.projectId] : assignedProjectIdsFor(photo),
  }));

  const buildBatchManifest = () => {
    const template = workflow().batchManifest?.template || {};
    const batchId = timestampId();
    const photos = selectedPhotos();
    const projects = projectGroupsFor(photos);
    return {
      ...template,
      schema: template.schema || workflow().batchManifest?.schema || "photosbyelie.realEstatePdfBatch.v1",
      batchId,
      createdAt: new Date().toISOString(),
      customer: template.customer || state.payload?.customer?.name || "",
      galleryKey: template.galleryKey || state.gallery?.key || "",
      sourceBatchId: template.sourceBatchId || "",
      pdfMode: "one-pdf-per-project",
      pdfSettings: {
        paperFormat: paperFormatFor().key,
        paperLabel: paperFormatFor().label,
        pageOrientation: "portrait",
        layout: "landscape-two-per-page-portrait-one-per-page",
        fitMode: "contain",
        photoWatermark: pdfWatermarkText,
        photoWatermarkPlacement: "bottom-center",
        pageWatermark: pdfWatermarkText,
        pageWatermarkPlacement: "footer-center",
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
      ["Project", "Order", "Title", "Photo ID"].join("\t"),
      ...rows.map(({ projectTitle, item }) => [
        projectTitle || item.projectTitle || "",
        item.sortIndex || "",
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
    <p>${escapeHtml(manifest.customer || state.payload?.customer?.name || "Client")} real-estate PDF draft</p>
    <dl class="meta">
      <div><dt>Batch</dt><dd><code>${escapeHtml(manifest.batchId || "")}</code></dd></div>
      <div><dt>Created</dt><dd>${escapeHtml(dateLabel)}</dd></div>
      <div><dt>Photos</dt><dd>${selectedCount}</dd></div>
      <div><dt>Projects</dt><dd>${projectCount}</dd></div>
      <div><dt>Paper</dt><dd>${escapeHtml(manifest.pdfSettings?.paperLabel || manifest.pdfSettings?.paperFormat || "")}</dd></div>
    </dl>
    <table>
      <thead>
        <tr>
          <th>Project</th>
          <th>Order</th>
          <th>Title</th>
          <th>Photo ID</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(({ projectTitle, item }) => `
        <tr>
          <td>${escapeHtml(projectTitle || item.projectTitle || "")}</td>
          <td>${escapeHtml(item.sortIndex || "")}</td>
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

  const copyBatch = async () => {
    if (!requireUnlocked()) return;
    const manifest = buildBatchManifest();
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
    if (!requireUnlocked()) return;
    const batch = buildBatchManifest();
    const blob = new Blob([selectionHtmlFor(batch)], { type: "text/html" });
    const filename = `${state.gallery?.key || "real-estate"}-${batch.batchId}-selection.html`;
    try {
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
    } catch (error) {
      setStatus(error?.name === "AbortError" ? "Share canceled" : "Selection table could not be shared");
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
    if (!requireUnlocked() || state.originalsBusy) return;
    const photos = selectedPhotos();
    if (!photos.length) {
      setStatus("Select photos before preparing originals ZIP");
      return;
    }
    state.originalsBusy = true;
    syncFileActionLabels();
    try {
      let session = null;
      let passwordMessage = "";
      for (let attempt = 0; attempt < 2 && !session; attempt += 1) {
        setStatus(`Preparing private original links for ${photos.length} selected photo${photos.length === 1 ? "" : "s"}...`);
        try {
          session = await requestOriginalsSession(photos, passwordMessage);
        } catch (error) {
          if (error?.code === "real_estate_auth_required" && attempt === 0) {
            clearSessionCredentials();
            passwordMessage = "That password did not work. Enter LaConcha exactly.";
            setStatus("Password did not work; enter LaConcha exactly to create the originals ZIP");
            continue;
          }
          throw error;
        }
      }
      if (!session) throw new Error("Originals ZIP could not be prepared.");
      const files = originalZipFilesFor(session);
      const totalBytes = Number(session.totalBytes) || files.reduce((sum, file) => sum + (Number(file.bytes) || 0), 0);
      setStatus(`Building originals ZIP from ${files.length} file${files.length === 1 ? "" : "s"}${totalBytes ? ` (${formatBytes(totalBytes)})` : ""}...`);
      const blob = await buildStoredZipBlob(files, ({ index, file, phase }) => {
        const number = index + 1;
        if (phase === "fetch") setStatus(`Fetching original ${number}/${files.length}: ${file.name}`);
        if (phase === "zip") setStatus(`Adding original ${number}/${files.length} to ZIP: ${file.name}`);
      });
      const filename = session.zipFilename || `${state.gallery?.key || "real-estate"}-originals-${timestampId()}.zip`;
      const saved = await shareOrOpenBlob({
        blob,
        filename,
        title: "Photos By Elie originals",
        text: `${state.payload?.customer?.name || "Client"} selected original photos`,
        openFallback: false,
      });
      if (saved.method === "share") {
        setStatus(`Shared ${saved.filename} (${formatBytes(saved.bytes)})`);
      } else {
        setStatus(`Downloaded ${saved.filename} to Downloads (${formatBytes(saved.bytes)})`);
      }
    } catch (error) {
      setStatus(error?.name === "AbortError" ? "Originals ZIP canceled" : (error?.message || "Originals ZIP failed"));
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

  const fetchPdfImages = async (photos) => {
    const images = [];
    for (const photo of photos) {
      const imageUrl = imageFor(photo, "detail");
      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error(`Could not load ${titleFor(photo)}`);
      const blob = await response.blob();
      images.push({
        blob,
        dimensions: pdfDimensionsFor(photo),
        photo,
      });
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

  const renderPdfPages = async (images) => {
    const pages = paginatePdfImages(images);
    const paper = paperFormatFor();
    const pageWidth = paper.width;
    const pageHeight = paper.height;
    const margin = 30;
    const titleArea = 28;
    const rowGap = 18;
    const scale = 2;
    const renderedPages = [];

    for (const page of pages) {
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
            fittedCanvasText(context, titleFor(item.photo), slot.width),
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
    }

    return {
      pages: renderedPages,
      pageWidth,
      pageHeight,
    };
  };

  const buildPdfBlob = async (images) => {
    const rendered = await renderPdfPages(images);
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

  const downloadPdf = async () => {
    if (!requireUnlocked() || state.pdfBusy) return;
    const photos = selectedPhotos();
    if (!photos.length) {
      setStatus("Select photos before downloading project PDFs");
      return;
    }
    const projects = projectGroupsFor(photos);
    const batchId = timestampId();
    const paper = paperFormatFor();
    state.pdfBusy = true;
    setStatus(`Building ${projects.length} ${paper.label} project PDF${projects.length === 1 ? "" : "s"} from ${photos.length} photos...`);
    let savedProjectCount = 0;
    try {
      for (const project of projects) {
        const blob = await buildPdfBlob(await fetchPdfImages(project.photos));
        const filename = `${state.gallery?.key || "real-estate"}-${fileSlug(project.projectTitle)}-${paper.key}-${batchId}.pdf`;
        const saved = await downloadBlob(blob, filename);
        savedProjectCount += 1;
        setStatus(`Downloaded ${saved.filename} to Downloads (${formatBytes(saved.bytes)})`);
      }
      setStatus(`Downloaded ${projects.length} ${paper.label} project PDF${projects.length === 1 ? "" : "s"} to Downloads with ${photos.length} photos`);
    } catch (error) {
      if (error?.name === "AbortError") {
        setStatus(savedProjectCount
          ? `Download canceled after ${savedProjectCount} project PDF${savedProjectCount === 1 ? "" : "s"}`
          : "PDF download canceled");
      } else {
        setStatus(error?.message || "PDF download failed");
      }
    } finally {
      state.pdfBusy = false;
    }
  };

  const selectVisible = () => {
    if (!requireUnlocked()) return;
    const visible = filteredPhotos().map((photo) => photo.id);
    visible.forEach((id) => {
      if (!state.selectedIds.has(id)) state.selectedOrder.push(id);
    });
    persistSelection();
    render();
  };

  const clearSelection = () => {
    if (!requireUnlocked()) return;
    state.selectedOrder = [];
    persistSelection();
    render();
  };

  const moveDraftItem = (photoId, direction) => {
    const index = state.selectedOrder.indexOf(photoId);
    const nextIndex = index + Number(direction);
    if (index < 0 || nextIndex < 0 || nextIndex >= state.selectedOrder.length) return;
    const next = [...state.selectedOrder];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    state.selectedOrder = next;
    persistSelection();
    render();
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
    const next = state.selectedOrder.filter((id) => id !== photoId);
    const targetIndex = next.indexOf(targetPhotoId);
    if (targetIndex < 0) return;
    next.splice(position === "after" ? targetIndex + 1 : targetIndex, 0, photoId);
    state.selectedOrder = next;
    persistSelection();
    render();
    setStatus(`Moved ${titleFor(state.photosById.get(photoId))} to position ${state.selectedOrder.indexOf(photoId) + 1}`);
  };

  const dialogPhotos = () => filteredPhotos();

  const showPhoto = (photoId) => {
    const photo = state.photosById.get(photoId);
    if (!photo || !elements.dialog) return;
    state.activePhotoId = photoId;
    if (elements.dialogImage) {
      elements.dialogImage.src = imageFor(photo, "detail");
      elements.dialogImage.alt = titleFor(photo);
    }
    if (elements.dialogAlbum) elements.dialogAlbum.textContent = albumTitleFor(photo);
    if (elements.dialogTitle) elements.dialogTitle.textContent = titleFor(photo);
    if (elements.dialogTitleInput) elements.dialogTitleInput.value = titleFor(photo);
    if (elements.dialogSelected) elements.dialogSelected.checked = state.selectedIds.has(photoId);
    if (elements.dialogDetails) {
      elements.dialogDetails.innerHTML = (photo.metadata || []).map((item) => `
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
    persistSelection();
    persistTitles();
    persistProjectAssignments();
    render();
    setStatus(`Loaded ${state.selectedOrder.length} selected photos across ${projectGroupsFor(selectedPhotos()).length} projects`);
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

    elements.loginForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      const expectedUser = expectedUsername();
      const expectedCode = expectedAccessCode();
      const enteredUser = normalizeCredential(elements.loginName?.value);
      const enteredCode = normalizeCredential(elements.loginCode?.value);
      if (!expectedUser || !expectedCode || enteredUser !== expectedUser || enteredCode !== expectedCode) {
        if (elements.loginStatus) elements.loginStatus.textContent = "Credentials do not match this review.";
        return;
      }
      state.unlocked = true;
      writeSessionCredentials(elements.loginName?.value || "", elements.loginCode?.value || "");
      writeSession(elements.loginName?.value || "");
      syncAuthUi();
      setStatus(`${state.photos.length} visible / ${state.photos.length} photos`);
      window.setTimeout(() => showHelp(), 120);
    });

    elements.albums?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-album-filter]");
      if (!button) return;
      if (!requireUnlocked()) return;
      state.album = button.dataset.albumFilter || "all";
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
    elements.density?.addEventListener("change", (event) => {
      state.density = event.target.value;
      localStorage.setItem(densityKey, state.density);
      renderGrid();
    });
    elements.mediaType?.addEventListener("change", (event) => {
      state.mediaType = ["all", "photo", "video"].includes(event.target.value) ? event.target.value : "all";
      event.target.value = state.mediaType;
      renderGrid();
    });
    elements.pdfFormat?.addEventListener("change", (event) => {
      state.pdfFormat = paperFormatFor(event.target.value).key;
      localStorage.setItem(pdfFormatKey, state.pdfFormat);
      event.target.value = state.pdfFormat;
    });
    elements.selectedOnly?.addEventListener("change", (event) => {
      state.selectedOnly = event.target.checked;
      renderGrid();
    });

    app.addEventListener("click", (event) => {
      const openButton = event.target.closest("[data-open-photo]");
      if (openButton && requireUnlocked()) showPhoto(openButton.dataset.openPhoto);

      if (event.target.closest("[data-re-clear-filters]")) {
        state.album = "all";
        state.query = "";
        state.sort = "album";
        state.mediaType = "all";
        state.selectedOnly = false;
        if (elements.search) elements.search.value = "";
        if (elements.sort) elements.sort.value = "album";
        if (elements.mediaType) elements.mediaType.value = "all";
        if (elements.selectedOnly) elements.selectedOnly.checked = false;
        render();
      }
      if (event.target.closest("[data-re-select-visible]")) selectVisible();
    });

    elements.grid?.addEventListener("change", (event) => {
      const checkbox = event.target.closest("[data-select-photo]");
      if (checkbox) setSelected(checkbox.dataset.selectPhoto, checkbox.checked);
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

    document.querySelectorAll("[data-re-copy-batch]").forEach((button) => button.addEventListener("click", copyBatch));
    document.querySelectorAll("[data-re-download-batch]").forEach((button) => button.addEventListener("click", () => {
      shareSelectionTable().catch(() => setStatus("Selection table could not be shared"));
    }));
    document.querySelectorAll("[data-re-download-originals]").forEach((button) => button.addEventListener("click", () => {
      shareOriginalsZip().catch(() => setStatus("Originals ZIP failed"));
    }));
    document.querySelectorAll("[data-re-download-pdf]").forEach((button) => button.addEventListener("click", downloadPdf));
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

    elements.dialogTitleInput?.addEventListener("input", (event) => setTitle(state.activePhotoId, event.target.value));
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
    state.selectedOrder = normalizeSelectedOrder(readJson(selectionStoreKey(), []));
    state.selectedIds = new Set(state.selectedOrder);
    state.editedTitles = readJson(titleStoreKey(), {});
    state.projectAssignments = readJson(projectStoreKey(), {});
    if (pageParams.has("logout")) {
      localStorage.removeItem(authStoreKey());
      clearSessionCredentials();
    }
    state.unlocked = hasUnlockedSession();
    const savedCredentials = readSessionCredentials();
    const savedSession = readJson(authStoreKey(), {});
    state.username = savedCredentials.username || savedSession.username || state.payload?.customer?.username || state.payload?.customer?.name || "";
    state.accessCode = savedCredentials.accessCode || "";
    if (elements.density) elements.density.value = state.density;
    state.pdfFormat = paperFormatFor(state.pdfFormat).key;
    if (elements.pdfFormat) elements.pdfFormat.value = state.pdfFormat;
    renderHero();
    render();
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
