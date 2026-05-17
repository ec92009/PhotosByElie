(() => {
  const app = document.querySelector("[data-real-estate-app]");
  if (!app) return;

  const pageParams = new URLSearchParams(window.location.search);
  const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
  const defaultLocalContext = "./tmp/real-estate-import/corine/app-context.js";
  const contextParam = pageParams.get("context");
  const contextUrl = contextParam || (isLocalHost ? defaultLocalContext : "");
  const densityKey = "photosbyelie-real-estate-card-density";

  const elements = {
    login: app.querySelector("[data-re-login]"),
    loginForm: app.querySelector("[data-re-login-form]"),
    loginCustomer: app.querySelector("[data-re-login-customer]"),
    loginName: app.querySelector("[data-re-login-name]"),
    loginCode: app.querySelector("[data-re-login-code]"),
    loginStatus: app.querySelector("[data-re-login-status]"),
    customer: app.querySelector("[data-re-customer]"),
    title: app.querySelector("[data-re-title]"),
    description: app.querySelector("[data-re-description]"),
    total: app.querySelector("[data-re-total]"),
    albumTotal: app.querySelector("[data-re-album-total]"),
    selectedTotal: app.querySelector("[data-re-selected-total]"),
    heroPreview: app.querySelector("[data-re-hero-preview]"),
    albums: app.querySelector("[data-re-albums]"),
    filterForm: app.querySelector("[data-re-filter-form]"),
    search: app.querySelector("[data-re-search]"),
    sort: app.querySelector("[data-re-sort]"),
    density: app.querySelector("[data-re-density]"),
    selectedOnly: app.querySelector("[data-re-selected-only]"),
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
    selectedOnly: false,
    selectedOrder: [],
    selectedIds: new Set(),
    editedTitles: {},
    activePhotoId: "",
    unlocked: false,
    pdfBusy: false,
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
  const authStoreKey = () => `photosbyelie-real-estate-session-${state.gallery?.key || "default"}`;

  const normalizeAccessCode = (value) => String(value || "").trim().toLowerCase();
  const expectedAccessCode = () => normalizeAccessCode(
    state.payload?.accessCode
    || state.payload?.customer?.accessCode
    || state.payload?.customer?.username
    || state.payload?.customer?.name
    || ""
  );

  const hasUnlockedSession = () => {
    const saved = readJson(authStoreKey(), {});
    return Boolean(saved?.unlocked && saved?.galleryKey === state.gallery?.key);
  };

  const writeSession = (name = "") => writeJson(authStoreKey(), {
    galleryKey: state.gallery?.key || "",
    name,
    unlocked: true,
    unlockedAt: new Date().toISOString(),
  });

  const syncAuthUi = () => {
    app.classList.toggle("is-locked", !state.unlocked);
    if (elements.actionBar) elements.actionBar.hidden = !state.unlocked;
    if (elements.loginStatus && state.unlocked) elements.loginStatus.textContent = "";
    if (!state.unlocked && elements.loginCode) elements.loginCode.value = "";
  };

  const requireUnlocked = () => {
    if (state.unlocked) return true;
    if (elements.loginStatus) elements.loginStatus.textContent = "Enter the client access code to open this review.";
    syncAuthUi();
    window.scrollTo({ top: 0, behavior: "smooth" });
    return false;
  };

  const imageFor = (photo, size = "gallery") => {
    const preview = photo?.media?.publicPreview || {};
    return safeUrl(
      size === "detail"
        ? preview.detailUrl || preview.previewUrl || photo?.imageSrc || preview.galleryUrl || photo?.gallerySrc
        : preview.galleryUrl || preview.thumbnailUrl || photo?.gallerySrc || preview.detailUrl || photo?.imageSrc
    );
  };

  const titleFor = (photo) => state.editedTitles[photo?.id] || photo?.editableTitle || photo?.title || photo?.id || "";
  const albumTitleFor = (photo) => photo?.albumTitle || photo?.caption || photo?.album || "Property";
  const photoSearchText = (photo) => [
    titleFor(photo),
    photo?.title,
    photo?.full,
    photo?.id,
    photo?.album,
    photo?.albumTitle,
    photo?.caption,
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

  const filteredPhotos = () => {
    const query = state.query.trim().toLowerCase();
    const selectedRank = new Map(state.selectedOrder.map((id, index) => [id, index]));
    const photos = state.photos.filter((photo) => {
      if (state.album !== "all" && photo.albumSlug !== state.album) return false;
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
    if (elements.actionStatus) elements.actionStatus.textContent = message;
  };

  const renderHero = () => {
    const { gallery, payload, photos } = state;
    const albums = state.albums;
    if (elements.loginCustomer) elements.loginCustomer.textContent = payload?.customer?.name ? `${payload.customer.name} access` : "Private client access";
    if (elements.loginName && !elements.loginName.value) elements.loginName.value = payload?.customer?.name || "";
    if (elements.customer) elements.customer.textContent = payload?.customer?.name ? `${payload.customer.name} review` : "Client review";
    if (elements.title) elements.title.textContent = gallery?.title || "Real estate selection";
    if (elements.description) elements.description.textContent = gallery?.description || "Private photo review workspace for property PDF delivery.";
    if (elements.total) elements.total.textContent = String(photos.length);
    if (elements.albumTotal) elements.albumTotal.textContent = String(albums.length);
    if (!elements.heroPreview) return;
    const heroPhotos = albums.flatMap((album) => {
      const albumPhotos = photos.filter((photo) => photo.albumSlug === album.slug);
      return [albumPhotos[0], albumPhotos[Math.floor(albumPhotos.length / 2)]].filter(Boolean);
    }).slice(0, 4);
    elements.heroPreview.innerHTML = heroPhotos.map((photo, index) => `
      <button class="real-estate-hero-tile tile-${index + 1}" type="button" data-open-photo="${escapeHtml(photo.id)}">
        <img src="${escapeHtml(imageFor(photo, index === 0 ? "detail" : "gallery"))}" alt="${escapeHtml(titleFor(photo))}"/>
        <span>${escapeHtml(albumTitleFor(photo))}</span>
      </button>
    `).join("");
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
      return `
        <article class="real-estate-photo-card ${selected ? "is-selected" : ""}" data-photo-id="${escapeHtml(photo.id)}">
          <button class="real-estate-photo-media" type="button" data-open-photo="${escapeHtml(photo.id)}" aria-label="Open ${escapeHtml(titleFor(photo))}">
            <img loading="lazy" src="${escapeHtml(imageFor(photo))}" alt="${escapeHtml(titleFor(photo))}"/>
            <span>${escapeHtml(albumTitleFor(photo))}</span>
          </button>
          <div class="real-estate-photo-card-body">
            <label class="real-estate-check">
              <input type="checkbox" data-select-photo="${escapeHtml(photo.id)}" ${selected ? "checked" : ""}/>
              <span>Select</span>
            </label>
            <label class="real-estate-title-field">
              <span>PDF title</span>
              <input type="text" data-title-photo="${escapeHtml(photo.id)}" value="${escapeHtml(titleFor(photo))}"/>
            </label>
          </div>
        </article>
      `;
    }).join("") : `
      <div class="real-estate-empty-state">
        <strong>No photos match this view.</strong>
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
      <article class="real-estate-draft-item" data-draft-photo="${escapeHtml(photo.id)}">
        <img src="${escapeHtml(imageFor(photo))}" alt=""/>
        <div>
          <strong>${escapeHtml(titleFor(photo))}</strong>
          <small>${escapeHtml(albumTitleFor(photo))}</small>
        </div>
        <div class="real-estate-draft-actions">
          <button type="button" data-move-draft="${escapeHtml(photo.id)}" data-direction="-1" aria-label="Move ${escapeHtml(titleFor(photo))} up">&uarr;</button>
          <button type="button" data-move-draft="${escapeHtml(photo.id)}" data-direction="1" aria-label="Move ${escapeHtml(titleFor(photo))} down">&darr;</button>
          <button type="button" data-remove-draft="${escapeHtml(photo.id)}" aria-label="Remove ${escapeHtml(titleFor(photo))}">&times;</button>
        </div>
        <span>${index + 1}</span>
      </article>
    `).join("") : `<p class="real-estate-muted">No selected photos yet.</p>`;
  };

  const render = () => {
    document.body.dataset.realEstateDensity = state.density;
    syncAuthUi();
    renderAlbums();
    renderGrid();
    renderDraft();
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

  const timestampId = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

  const buildBatchManifest = () => {
    const template = workflow().batchManifest?.template || {};
    const batchId = timestampId();
    const selectedPhotos = state.selectedOrder.map((id) => state.photosById.get(id)).filter(Boolean);
    return {
      ...template,
      schema: template.schema || workflow().batchManifest?.schema || "photosbyelie.realEstatePdfBatch.v1",
      batchId,
      createdAt: new Date().toISOString(),
      customer: template.customer || state.payload?.customer?.name || "",
      galleryKey: template.galleryKey || state.gallery?.key || "",
      sourceBatchId: template.sourceBatchId || "",
      items: selectedPhotos.map((photo, index) => ({
        photoId: photo.id,
        title: titleFor(photo),
        sortIndex: index + 1,
      })),
    };
  };

  const copyBatch = async () => {
    if (!requireUnlocked()) return;
    const batch = JSON.stringify(buildBatchManifest(), null, 2);
    try {
      await navigator.clipboard.writeText(batch);
      setStatus(`Copied ${state.selectedOrder.length} selected photos`);
    } catch {
      setStatus("Clipboard unavailable; use Download batch");
    }
  };

  const downloadBatch = () => {
    if (!requireUnlocked()) return;
    const batch = buildBatchManifest();
    const blob = new Blob([JSON.stringify(batch, null, 2) + "\n"], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${state.gallery?.key || "real-estate"}-${batch.batchId}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    setStatus(`Downloaded ${state.selectedOrder.length} selected photos`);
  };

  const pdfEscape = (value) => String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");

  const pdfDimensionsFor = (photo) => {
    const dimensions = photo?.cloudPdfSource?.dimensions
      || photo?.media?.publicPreview?.detailDimensions
      || photo?.media?.publicPreview?.dimensions
      || {};
    const width = Number(dimensions.width) || 1800;
    const height = Number(dimensions.height) || 1200;
    return { width, height };
  };

  const truncatePdfTitle = (value) => {
    const text = String(value || "");
    return text.length > 86 ? `${text.slice(0, 83)}...` : text;
  };

  const fetchPdfImages = async (photos) => {
    const images = [];
    for (const photo of photos) {
      const imageUrl = imageFor(photo, "detail");
      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error(`Could not load ${titleFor(photo)}`);
      images.push({
        bytes: new Uint8Array(await response.arrayBuffer()),
        dimensions: pdfDimensionsFor(photo),
        photo,
      });
    }
    return images;
  };

  const buildPdfBlob = (images) => {
    const encoder = new TextEncoder();
    const objects = [];
    const setObject = (id, parts) => {
      objects[id] = parts;
      return id;
    };
    const toBytes = (part) => part instanceof Uint8Array ? part : encoder.encode(String(part));
    const objectCount = 3 + images.length * 3;
    const pageIds = [];
    let nextId = 4;

    setObject(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
    setObject(3, ["<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]);

    images.forEach((item, index) => {
      const imageId = nextId++;
      const contentId = nextId++;
      const pageId = nextId++;
      const { width: imageWidth, height: imageHeight } = item.dimensions;
      const landscape = imageWidth >= imageHeight;
      const pageWidth = landscape ? 842 : 595;
      const pageHeight = landscape ? 595 : 842;
      const maxWidth = pageWidth - 60;
      const maxHeight = pageHeight - 96;
      const scale = Math.min(maxWidth / imageWidth, maxHeight / imageHeight);
      const drawWidth = imageWidth * scale;
      const drawHeight = imageHeight * scale;
      const drawX = (pageWidth - drawWidth) / 2;
      const drawY = 30 + ((maxHeight - drawHeight) / 2);
      const imageName = `Im${index + 1}`;
      const title = pdfEscape(truncatePdfTitle(titleFor(item.photo)));
      const content = [
        "q\n",
        `${drawWidth.toFixed(2)} 0 0 ${drawHeight.toFixed(2)} ${drawX.toFixed(2)} ${drawY.toFixed(2)} cm\n`,
        `/${imageName} Do\n`,
        "Q\n",
        "BT\n",
        "/F1 14 Tf\n",
        `30 ${Math.round(pageHeight - 34)} Td\n`,
        `(${title}) Tj\n`,
        "ET\n",
      ].join("");

      setObject(imageId, [
        `<< /Type /XObject /Subtype /Image /Width ${Math.round(imageWidth)} /Height ${Math.round(imageHeight)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${item.bytes.byteLength} >>\nstream\n`,
        item.bytes,
        "\nendstream",
      ]);
      setObject(contentId, [
        `<< /Length ${encoder.encode(content).byteLength} >>\nstream\n`,
        content,
        "endstream",
      ]);
      setObject(pageId, [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R >> /XObject << /${imageName} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
      ]);
      pageIds.push(pageId);
    });

    setObject(2, [`<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`]);

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
    const selectedPhotos = state.selectedOrder.map((id) => state.photosById.get(id)).filter(Boolean);
    if (!selectedPhotos.length) {
      setStatus("Select photos before downloading PDF");
      return;
    }
    state.pdfBusy = true;
    setStatus(`Building PDF from ${selectedPhotos.length} photos...`);
    try {
      const blob = buildPdfBlob(await fetchPdfImages(selectedPhotos));
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${state.gallery?.key || "real-estate"}-${timestampId()}.pdf`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      setStatus(`Downloaded PDF with ${selectedPhotos.length} photos`);
    } catch (error) {
      setStatus(error?.message || "PDF download failed");
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
    renderDraft();
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
    if (typeof elements.dialog.showModal === "function") {
      if (!elements.dialog.open) elements.dialog.showModal();
    } else {
      elements.dialog.setAttribute("open", "");
    }
  };

  const stepDialog = (direction) => {
    const photos = dialogPhotos();
    const index = photos.findIndex((photo) => photo.id === state.activePhotoId);
    if (index < 0 || !photos.length) return;
    const next = photos[(index + direction + photos.length) % photos.length];
    showPhoto(next.id);
  };

  const loadBatchFile = async (file) => {
    if (!file) return;
    const text = await file.text();
    const batch = JSON.parse(text);
    const items = Array.isArray(batch.items) ? [...batch.items].sort((a, b) => Number(a.sortIndex) - Number(b.sortIndex)) : [];
    state.selectedOrder = items.map((item) => item.photoId).filter((id) => state.photosById.has(id));
    items.forEach((item) => {
      if (item.photoId && typeof item.title === "string") state.editedTitles[item.photoId] = item.title;
    });
    persistSelection();
    persistTitles();
    render();
    setStatus(`Loaded ${state.selectedOrder.length} selected photos`);
  };

  const bindEvents = () => {
    elements.loginForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      const expected = expectedAccessCode();
      const entered = normalizeAccessCode(elements.loginCode?.value);
      if (!expected || entered !== expected) {
        if (elements.loginStatus) elements.loginStatus.textContent = "Access code does not match this review.";
        return;
      }
      state.unlocked = true;
      writeSession(elements.loginName?.value || "");
      syncAuthUi();
      setStatus(`${state.photos.length} visible / ${state.photos.length} photos`);
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
        state.selectedOnly = false;
        if (elements.search) elements.search.value = "";
        if (elements.sort) elements.sort.value = "album";
        if (elements.selectedOnly) elements.selectedOnly.checked = false;
        render();
      }
      if (event.target.closest("[data-re-select-visible]")) selectVisible();
    });

    elements.grid?.addEventListener("change", (event) => {
      const checkbox = event.target.closest("[data-select-photo]");
      if (checkbox) setSelected(checkbox.dataset.selectPhoto, checkbox.checked);
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

    document.querySelectorAll("[data-re-copy-batch]").forEach((button) => button.addEventListener("click", copyBatch));
    document.querySelectorAll("[data-re-download-batch]").forEach((button) => button.addEventListener("click", downloadBatch));
    document.querySelectorAll("[data-re-download-pdf]").forEach((button) => button.addEventListener("click", downloadPdf));
    document.querySelectorAll("[data-re-clear-selection]").forEach((button) => button.addEventListener("click", clearSelection));
    document.querySelectorAll("[data-re-logout]").forEach((button) => button.addEventListener("click", () => {
      localStorage.removeItem(authStoreKey());
      state.unlocked = false;
      syncAuthUi();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }));
    document.querySelector("[data-re-load-batch]")?.addEventListener("change", (event) => {
      loadBatchFile(event.target.files?.[0]).catch(() => setStatus("Batch file could not be loaded"));
      event.target.value = "";
    });

    elements.dialogTitleInput?.addEventListener("input", (event) => setTitle(state.activePhotoId, event.target.value));
    elements.dialogSelected?.addEventListener("change", (event) => setSelected(state.activePhotoId, event.target.checked));
    document.querySelector("[data-re-dialog-prev]")?.addEventListener("click", () => stepDialog(-1));
    document.querySelector("[data-re-dialog-next]")?.addEventListener("click", () => stepDialog(1));
    elements.dialog?.addEventListener("click", (event) => {
      if (event.target === elements.dialog) elements.dialog.close?.();
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
    if (pageParams.has("logout")) localStorage.removeItem(authStoreKey());
    const accessParam = pageParams.get("access");
    if (accessParam && normalizeAccessCode(accessParam) === expectedAccessCode()) {
      writeSession(payload?.customer?.name || "");
    }
    state.unlocked = hasUnlockedSession();
    if (elements.density) elements.density.value = state.density;
    renderHero();
    render();
  };

  const initialize = async () => {
    try {
      if (!window.photosByElieRealEstateImport) await loadScript(contextUrl);
      if (!window.photosByElieRealEstateImport) throw new Error("No real-estate context loaded.");
      initializeFromPayload(window.photosByElieRealEstateImport);
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
  };

  initialize();
})();
