(() => {
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  const ownerSurface = new URLSearchParams(window.location.search).get("gallery") === "pbe-owner";
  const fragmentKey = "pbe_owner_ticket";
  const localBase = "/__photosbyelie/pbe-owner";
  const galleryKey = "pbe-owner";
  let browserTicket = "";
  let state = {
    phase: "unavailable",
    ready: false,
    session: null,
    message: "Owner actions are available only when this page is opened by Backstage on a Mac.",
  };
  let heartbeatTimer = 0;
  let bannerResizeObserver = null;

  const consumeFragment = () => {
    const raw = window.location.hash.replace(/^#/, "");
    const parameters = new URLSearchParams(raw);
    const value = parameters.get(fragmentKey) || "";
    if (!value) return "";
    parameters.delete(fragmentKey);
    const nextHash = parameters.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${nextHash ? `#${nextHash}` : ""}`);
    return value;
  };

  const update = (next) => {
    state = { ...state, ...next };
    render();
    window.dispatchEvent(new CustomEvent("photosbyelie:pbeownerchange", { detail: publicState() }));
  };

  const publicState = () => ({
    phase: state.phase,
    ready: state.ready,
    session: state.session ? { ...state.session } : null,
    message: state.message,
  });

  const fixturePhoto = (item) => {
    const width = Math.max(0, Number(item?.pixelWidth) || 0);
    const height = Math.max(0, Number(item?.pixelHeight) || 0);
    const mediaType = String(item?.mediaType || "photo").toLowerCase();
    const previewUrl = `/__photosbyelie/source-preview/${encodeURIComponent(String(item?.assetId || ""))}`;
    const dimensions = width && height ? { width, height } : null;
    const size = width && height ? `${width} x ${height}` : "Unknown";
    return {
      id: String(item?.assetId || ""),
      title: String(item?.title || item?.filename || item?.assetId || "Untitled"),
      keywords: Array.isArray(item?.keywords) ? item.keywords : [],
      megapixels: width && height ? Math.round((width * height / 1_000_000) * 10) / 10 : 0,
      previewDimensions: dimensions,
      sourceFiles: item?.filename ? [{ label: String(item.filename), type: String(item?.resourceFormat || "source/full") }] : [],
      metadata: [
        { label: "Captured", value: String(item?.capturedAt || "") },
        { label: "Original file", value: String(item?.filename || "") },
        { label: "Original size", value: size },
        { label: "Keywords", value: (Array.isArray(item?.keywords) ? item.keywords : []).join(", ") },
      ].filter((entry) => entry.value),
      media: {
        type: mediaType,
        publicPreview: {
          allowed: mediaType !== "video",
          galleryUrl: mediaType === "video" ? "" : previewUrl,
          detailUrl: mediaType === "video" ? "" : previewUrl,
          dimensions,
        },
      },
    };
  };

  const loadFixtureGallery = async (session) => {
    const payload = await request("/gallery");
    const gallery = payload?.gallery;
    if (!gallery || gallery.fixtureId !== session?.fixtureId || !Array.isArray(gallery.items)) {
      throw new Error("The hosted gallery does not match the frozen Backstage fixture.");
    }
    const photos = gallery.items.map(fixturePhoto).filter((photo) => photo.id);
    window.photosByElieData = window.photosByElieData || {};
    window.photosByElieData[galleryKey] = {
      number: "",
      title: String(gallery.fixtureBreadcrumb || session.fixtureBreadcrumb || "PBE Owner"),
      description: gallery.truncated
        ? `Showing the first ${photos.length} of ${Number(gallery.summary?.filtered) || photos.length} picked fixture items.`
        : `${photos.length} picked fixture item${photos.length === 1 ? "" : "s"}.`,
      accent: "pbe-owner-gallery",
      photos,
      fixtureId: session.fixtureId,
      truncated: Boolean(gallery.truncated),
      total: Number(gallery.summary?.filtered) || photos.length,
    };
    return window.photosByElieData[galleryKey];
  };

  const readyMessage = (session) => {
    const gallery = window.photosByElieData?.[galleryKey];
    const count = Number(gallery?.photos?.length) || 0;
    const scope = gallery?.truncated ? ` First ${count} picked items loaded.` : ` ${count} picked item${count === 1 ? "" : "s"} loaded.`;
    return `Fixture frozen until ${new Date(session.expiresAt).toLocaleTimeString()}.${scope} X moves photos only to the recoverable Waste Basket.`;
  };

  const request = async (path, { method = "GET", body = null } = {}) => {
    const isPost = method === "POST";
    const requestBody = isPost ? (body || {}) : body;
    const response = await fetch(`${localBase}${path}`, {
      method,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(isPost ? { "Content-Type": "application/json" } : {}),
      },
      body: requestBody ? JSON.stringify(requestBody) : null,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.ok) {
      const detail = payload?.error;
      const error = new Error(detail?.message || detail || "PBE Owner session is unavailable.");
      error.code = detail?.code || "pbe_owner_session_unavailable";
      throw error;
    }
    return payload;
  };

  const banner = () => {
    let root = document.querySelector("[data-pbe-owner-session]");
    if (root || !localHost || !ownerSurface || state.phase === "unavailable") return root;
    root = document.createElement("aside");
    root.className = "pbe-owner-session";
    root.dataset.pbeOwnerSession = "";
    root.setAttribute("role", "region");
    root.setAttribute("aria-label", "PBE Owner session");
    root.innerHTML = `
      <span class="pbe-owner-session-mark" aria-hidden="true">●</span>
      <span class="pbe-owner-session-copy">
        <strong data-pbe-owner-title>PBE Owner</strong>
        <span data-pbe-owner-message role="status" aria-live="polite"></span>
      </span>
      <button type="button" data-pbe-owner-close>End Owner session</button>
    `;
    root.querySelector("[data-pbe-owner-close]")?.addEventListener("click", () => close().catch(() => {}));
    const topbar = document.querySelector("header.topbar");
    if (topbar) topbar.insertAdjacentElement("afterend", root);
    else document.body.prepend(root);
    document.body.classList.add("has-pbe-owner-session");
    const syncBannerHeight = () => {
      document.documentElement.style.setProperty(
        "--pbe-owner-banner-height",
        `${Math.ceil(root.getBoundingClientRect().height)}px`,
      );
    };
    syncBannerHeight();
    if ("ResizeObserver" in window) {
      bannerResizeObserver = new ResizeObserver(syncBannerHeight);
      bannerResizeObserver.observe(root);
    }
    return root;
  };

  const render = () => {
    const root = banner();
    if (!root) return;
    root.dataset.state = state.phase;
    const title = root.querySelector("[data-pbe-owner-title]");
    const message = root.querySelector("[data-pbe-owner-message]");
    const closeButton = root.querySelector("[data-pbe-owner-close]");
    if (title) title.textContent = state.ready
      ? `PBE Owner · ${state.session?.fixtureBreadcrumb || state.session?.fixtureId || "frozen fixture"}`
      : "PBE Owner unavailable";
    if (message) message.textContent = state.message;
    if (closeButton) closeButton.disabled = !state.session || state.phase === "closing";
  };

  const failClosed = (error) => {
    window.clearInterval(heartbeatTimer);
    heartbeatTimer = 0;
    browserTicket = "";
    update({
      phase: "unavailable",
      ready: false,
      session: null,
      message: error?.message || "PBE Owner session is unavailable.",
    });
  };

  const heartbeat = async () => {
    try {
      const payload = await request("/session/heartbeat", { method: "POST" });
      update({
        phase: "ready",
        ready: true,
        session: payload.session,
        message: readyMessage(payload.session),
      });
    } catch (error) {
      failClosed(error);
    }
  };

  const bootstrap = async () => {
    if (!localHost || !ownerSurface) return publicState();
    update({ phase: "checking", ready: false, message: "Validating the Backstage fixture lease…" });
    try {
      if (browserTicket) {
        await request("/browser/bootstrap", {
          method: "POST",
          body: { ticket: browserTicket },
        });
        browserTicket = "";
      }
      const payload = await request("/session");
      await loadFixtureGallery(payload.session);
      update({
        phase: "ready",
        ready: true,
        session: payload.session,
        message: readyMessage(payload.session),
      });
      heartbeatTimer = window.setInterval(heartbeat, 30_000);
    } catch (error) {
      failClosed(error);
    }
    return publicState();
  };

  const action = async (operation, payload = {}) => {
    if (!state.ready || !state.session) {
      throw new Error(state.message || "PBE Owner session is not ready.");
    }
    const response = await fetch(`${localBase}/action`, {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Idempotency-Key": `pbe-owner-${Date.now().toString(36)}-${crypto.randomUUID()}`,
      },
      body: JSON.stringify({
        ...payload,
        action: operation,
        fixtureId: state.session.fixtureId,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result?.ok) {
      const detail = result?.error;
      if ([401, 403, 409].includes(response.status)) failClosed(new Error(detail?.message || "PBE Owner authorization ended."));
      throw new Error(detail?.message || detail || `PBE Owner action failed: ${operation}`);
    }
    return result;
  };

  const close = async () => {
    if (!state.session) return;
    update({ phase: "closing", ready: false, message: "Closing the fixture lease…" });
    try {
      await request("/session/close", { method: "POST" }).catch(() => null);
    } finally {
      failClosed(new Error("PBE Owner session closed. Reopen it from Backstage to act again."));
    }
  };

  browserTicket = consumeFragment();
  window.photosByEliePBEOwnerSession = {
    action,
    bootstrap,
    close,
    isReady: () => state.ready,
    state: publicState,
  };
  window.photosByEliePBEOwnerSessionReady = bootstrap();
})();
