(() => {
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  const requestedGallery = String(new URLSearchParams(window.location.search).get("gallery") || "").trim().toLowerCase();
  const ownerSurface = requestedGallery === "pbe-owner";
  const fragmentKey = "pbe_owner_ticket";
  const localBase = "/__photosbyelie/pbe-owner";
  const galleryKey = "pbe-owner";
  const lifecycleStoragePrefix = "photosbyelie-pbe-owner-lifecycle:";
  const pendingActionStoragePrefix = "photosbyelie-pbe-owner-pending-action:";
  let browserTicket = "";
  let state = {
    phase: "unavailable",
    ready: false,
    session: null,
    message: "Owner actions are available only when this page is opened by Backstage on a Mac.",
    lifecycle: null,
    lifecycleRetrying: false,
    lifecycleRetryError: "",
    pendingAction: null,
    pendingActionRefreshing: false,
    pendingActionError: "",
  };
  let heartbeatTimer = 0;
  let sessionGeneration = 0;
  let bannerResizeObserver = null;

  // The hosted Owner route intentionally does not depend on the public SQLite
  // catalog. Observe those background promises so an expected public-catalog
  // failure cannot become an unhandled rejection while the fixture session is
  // loading its private, frozen gallery.
  if (ownerSurface) {
    window.photosByElieCatalogReady?.catch(() => {});
    window.photosByElieSharedGalleryReady?.catch(() => {});
  }

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
    lifecycle: state.lifecycle ? JSON.parse(JSON.stringify(state.lifecycle)) : null,
    lifecycleRetrying: state.lifecycleRetrying,
    lifecycleRetryError: state.lifecycleRetryError,
    pendingAction: state.pendingAction ? { ...state.pendingAction } : null,
    pendingActionRefreshing: state.pendingActionRefreshing,
    pendingActionError: state.pendingActionError,
  });

  const lifecycleStorageKey = (session = state.session) => {
    const sessionId = String(session?.id || "").trim();
    return sessionId ? `${lifecycleStoragePrefix}${encodeURIComponent(sessionId)}` : "";
  };

  const pendingActionStorageKey = (session = state.session) => {
    const sessionId = String(session?.id || "").trim();
    return sessionId ? `${pendingActionStoragePrefix}${encodeURIComponent(sessionId)}` : "";
  };

  const lifecycleStorage = () => {
    try {
      return window.sessionStorage || null;
    } catch {
      return null;
    }
  };

  const normalizedLifecycleResult = (payload) => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const requestId = String(payload.requestId || "").trim();
    const authoritativeInput = payload.authoritative && typeof payload.authoritative === "object"
      ? payload.authoritative
      : {};
    const projectionInput = payload.projection && typeof payload.projection === "object"
      ? payload.projection
      : {};
    const publicationInput = payload.catalogPublication && typeof payload.catalogPublication === "object"
      ? payload.catalogPublication
      : {};
    const retryInput = payload.projectionRetry && typeof payload.projectionRetry === "object"
      ? payload.projectionRetry
      : {};
    const authoritativeState = String(
      authoritativeInput.state || (payload.authoritative_committed ? "committed" : "unconfirmed"),
    ).trim();
    const projectionState = String(projectionInput.state || "").trim();
    const publicationState = String(
      publicationInput.state || (payload.catalog_publish_pending ? "pending" : ""),
    ).trim();
    if (!requestId || (!authoritativeState && !projectionState && !publicationState)) return null;
    const operationRevision = Math.max(0, Number(retryInput.operationRevision) || 0);
    const retryToken = String(retryInput.token || "").trim();
    return {
      requestId,
      state: String(payload.state || "completed"),
      authoritative: {
        state: authoritativeState || "unconfirmed",
        operationId: String(authoritativeInput.operationId || ""),
        revision: Math.max(0, Number(authoritativeInput.revision) || 0),
        receiptState: String(authoritativeInput.receiptState || ""),
      },
      projection: {
        state: projectionState || "unreported",
        retryable: Boolean(projectionInput.retryable),
        errorCode: String(projectionInput.error_code || projectionInput.errorCode || ""),
      },
      catalogPublication: {
        state: publicationState || "unreported",
        hasReceipt: Boolean(publicationInput.receipt),
      },
      projectionRetry: {
        available: Boolean(retryInput.available && retryToken && operationRevision > 0),
        token: retryToken,
        operationRevision,
        attempt: Math.max(0, Number(retryInput.attempt) || 0),
      },
    };
  };

  const readLifecycleResult = (session) => {
    const key = lifecycleStorageKey(session);
    const storage = lifecycleStorage();
    if (!key || !storage) return null;
    try {
      return normalizedLifecycleResult(JSON.parse(storage.getItem(key) || "null"));
    } catch {
      return null;
    }
  };

  const writeLifecycleResult = (lifecycle, session = state.session) => {
    const key = lifecycleStorageKey(session);
    const storage = lifecycleStorage();
    if (!key || !storage || !lifecycle) return;
    try {
      storage.setItem(key, JSON.stringify(lifecycle));
    } catch {
      // The durable backend remains authoritative when same-tab storage is unavailable.
    }
  };

  const clearLifecycleResult = (session) => {
    const key = lifecycleStorageKey(session);
    const storage = lifecycleStorage();
    if (!key || !storage) return;
    try {
      storage.removeItem(key);
    } catch {
      // A failed browser cache cleanup cannot change durable lifecycle truth.
    }
  };

  const normalizedPendingAction = (payload) => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const requestId = String(payload.requestId || "").trim();
    const pendingState = String(payload.state || "").trim();
    if (!requestId || !["queued", "running"].includes(pendingState)) return null;
    return { requestId, state: pendingState };
  };

  const readPendingAction = (session) => {
    const key = pendingActionStorageKey(session);
    const storage = lifecycleStorage();
    if (!key || !storage) return null;
    try {
      return normalizedPendingAction(JSON.parse(storage.getItem(key) || "null"));
    } catch {
      return null;
    }
  };

  const writePendingAction = (pendingAction, session = state.session) => {
    const key = pendingActionStorageKey(session);
    const storage = lifecycleStorage();
    const normalized = normalizedPendingAction(pendingAction);
    if (!key || !storage || !normalized) return;
    try {
      storage.setItem(key, JSON.stringify(normalized));
    } catch {
      // The durable backend prevents duplicate active intents when storage is unavailable.
    }
  };

  const clearPendingAction = (session = state.session) => {
    const key = pendingActionStorageKey(session);
    const storage = lifecycleStorage();
    if (!key || !storage) return;
    try {
      storage.removeItem(key);
    } catch {
      // Browser cache cleanup cannot change the connector's durable request state.
    }
  };

  const recordLifecycleResult = (payload) => {
    const lifecycle = normalizedLifecycleResult(payload);
    if (!lifecycle || !state.session) return payload;
    clearPendingAction();
    writeLifecycleResult(lifecycle);
    update({
      lifecycle,
      lifecycleRetrying: false,
      lifecycleRetryError: "",
      pendingAction: null,
      pendingActionRefreshing: false,
      pendingActionError: "",
    });
    return payload;
  };

  const lifecycleCopy = (lifecycle) => {
    const authoritative = {
      committed: "Committed",
      unconfirmed: "Not confirmed",
    }[lifecycle?.authoritative?.state] || "Not reported";
    const projection = {
      pending: "Pending retry",
      partial: "Partially projected",
      applied: "Applied locally",
      "skipped-no-static-catalog": "Intentionally skipped (no static catalog)",
      unreported: "Not reported",
    }[lifecycle?.projection?.state] || "Not reported";
    const publication = {
      pending: "Pending release receipt",
      published: lifecycle?.catalogPublication?.hasReceipt ? "Published (receipt recorded)" : "Published",
      applied: lifecycle?.catalogPublication?.hasReceipt ? "Published (receipt recorded)" : "Published",
      "not-needed": "No publication needed",
      unreported: "Not reported",
    }[lifecycle?.catalogPublication?.state] || "Not reported";
    let help = "Lifecycle status is available after the authoritative action completes.";
    if (lifecycle?.authoritative?.state !== "committed") {
      help = "The authoritative lifecycle decision is not confirmed; no repair action is available.";
    } else if (lifecycle?.projectionRetry?.available) {
      help = "Retry repairs only the local/static projection. Public publication still requires a Backstage Uploads receipt.";
    } else if (lifecycle?.projection?.state === "partial") {
      help = "The authoritative decision is committed, but this projection needs Backstage review. Public publication still requires an Uploads receipt.";
    } else if (lifecycle?.projection?.state === "skipped-no-static-catalog") {
      help = "Static projection is intentionally skipped. Public publication still requires a Backstage Uploads receipt when applicable.";
    } else if (lifecycle?.catalogPublication?.state === "pending") {
      help = "Local projection is complete. Public availability or revocation is not proven until Backstage Uploads records a release receipt.";
    }
    return { authoritative, projection, publication, help };
  };

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
          galleryUrl: mediaType === "video" ? "" : `${previewUrl}?size=gallery`,
          detailUrl: mediaType === "video" ? "" : `${previewUrl}?size=detail`,
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
      // The frozen session is the authoritative fixture label. The gallery
      // payload may have been produced by an older host and must not leak its
      // internal collection key into the visible Owner surface.
      title: String(session.fixtureBreadcrumb || gallery.fixtureBreadcrumb || "PBE Owner"),
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

  const pendingActionMessage = (pendingAction = state.pendingAction, error = state.pendingActionError) => {
    const activity = pendingAction?.state === "running" ? "running" : "safely queued";
    const suffix = error ? ` Status refresh failed: ${error}` : "";
    return `A lifecycle action is ${activity} on the trusted Mac connector. New actions are paused until it resolves.${suffix}`;
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
      error.status = response.status;
      throw error;
    }
    return payload;
  };

  const actionStatusState = (payload) => String(
    payload?.state || (payload ? "completed" : "idle"),
  ).trim();

  const actionFailureMessage = (payload) => String(
    payload?.error?.message || payload?.error || "The trusted Mac connector could not complete this action.",
  ).trim();

  const actionStatusSnapshot = (payload, session = state.session, fallbackLifecycle = state.lifecycle) => {
    const status = actionStatusState(payload);
    const pendingAction = normalizedPendingAction(payload);
    if (pendingAction) {
      writePendingAction(pendingAction, session);
      clearLifecycleResult(session);
      return {
        pendingAction,
        pendingActionRefreshing: false,
        pendingActionError: "",
        lifecycle: null,
        lifecycleRetrying: false,
        lifecycleRetryError: "",
        message: pendingActionMessage(pendingAction, ""),
      };
    }

    clearPendingAction(session);
    if (["failed", "blocked"].includes(status)) {
      const pendingActionError = actionFailureMessage(payload);
      const disposition = status === "blocked" ? "blocked" : "failed";
      return {
        pendingAction: null,
        pendingActionRefreshing: false,
        pendingActionError,
        lifecycle: fallbackLifecycle,
        lifecycleRetrying: false,
        lifecycleRetryError: "",
        message: `The last lifecycle action is ${disposition}: ${pendingActionError} New actions are available again.`,
      };
    }
    if (status === "idle") {
      return {
        pendingAction: null,
        pendingActionRefreshing: false,
        pendingActionError: "",
        lifecycle: fallbackLifecycle,
        lifecycleRetrying: false,
        lifecycleRetryError: "",
        message: readyMessage(session),
      };
    }

    const lifecycle = normalizedLifecycleResult(payload) || fallbackLifecycle;
    if (lifecycle) writeLifecycleResult(lifecycle, session);
    return {
      pendingAction: null,
      pendingActionRefreshing: false,
      pendingActionError: "",
      lifecycle,
      lifecycleRetrying: false,
      lifecycleRetryError: "",
      message: readyMessage(session),
    };
  };

  const applyActionStatus = (payload, { session = state.session, dispatchRecovered = false } = {}) => {
    const wasPending = Boolean(state.pendingAction);
    const snapshot = actionStatusSnapshot(payload, session);
    update(snapshot);
    if (dispatchRecovered && wasPending && actionStatusState(payload) === "completed") {
      window.dispatchEvent(new CustomEvent("photosbyelie:pbeowneractionresult", { detail: payload }));
    }
    return payload;
  };

  const refreshPendingAction = async ({ dispatchRecovered = true } = {}) => {
    if (!state.ready || !state.session) {
      throw new Error(state.message || "PBE Owner session is not ready.");
    }
    const cached = state.pendingAction || readPendingAction(state.session);
    const requestId = String(cached?.requestId || "").trim();
    update({
      pendingAction: cached,
      pendingActionRefreshing: true,
      pendingActionError: "",
      message: "Refreshing the trusted Mac connector action status…",
    });
    try {
      const path = requestId
        ? `/action/status?requestId=${encodeURIComponent(requestId)}`
        : "/action/status";
      const payload = await request(path);
      return applyActionStatus(payload, { dispatchRecovered });
    } catch (error) {
      if ([401, 403].includes(error?.status)) {
        failClosed(error);
      } else if (state.pendingAction) {
        const pendingActionError = error?.message || "Action status is temporarily unavailable.";
        update({
          pendingActionRefreshing: false,
          pendingActionError,
          message: pendingActionMessage(state.pendingAction, pendingActionError),
        });
      } else {
        update({
          pendingActionRefreshing: false,
          pendingActionError: error?.message || "Action status is temporarily unavailable.",
        });
      }
      throw error;
    }
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
      <span class="pbe-owner-session-mark" aria-hidden="true">
        <span class="pbe-owner-session-spinner"></span>
        <span class="pbe-owner-session-dot">●</span>
      </span>
      <span class="pbe-owner-session-copy">
        <strong data-pbe-owner-title>PBE Owner</strong>
        <span data-pbe-owner-message role="status" aria-live="polite"></span>
      </span>
      <span class="pbe-owner-session-actions">
        <button type="button" data-pbe-owner-action-refresh hidden>Refresh action status</button>
        <button type="button" data-pbe-owner-close>End Owner session</button>
      </span>
      <section class="pbe-owner-lifecycle" data-pbe-owner-lifecycle aria-label="Latest lifecycle action" aria-live="polite" aria-atomic="true" hidden>
        <strong>Latest lifecycle action</strong>
        <dl>
          <div><dt>Authoritative lifecycle</dt><dd data-pbe-owner-authoritative></dd></div>
          <div><dt>Local/static projection</dt><dd data-pbe-owner-projection></dd></div>
          <div><dt>Public catalog</dt><dd data-pbe-owner-publication></dd></div>
        </dl>
        <span data-pbe-owner-layer-help></span>
        <span data-pbe-owner-retry-error role="status" aria-live="polite"></span>
        <button type="button" data-pbe-owner-retry>Retry local projection</button>
      </section>
    `;
    root.querySelector("[data-pbe-owner-close]")?.addEventListener("click", () => close().catch(() => {}));
    root.querySelector("[data-pbe-owner-action-refresh]")?.addEventListener("click", () => refreshPendingAction().catch(() => {}));
    root.querySelector("[data-pbe-owner-retry]")?.addEventListener("click", () => retryProjection().catch(() => {}));
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
    if (document.body?.dataset) document.body.dataset.pbeOwnerSessionState = state.phase;
    const title = root.querySelector("[data-pbe-owner-title]");
    const message = root.querySelector("[data-pbe-owner-message]");
    const closeButton = root.querySelector("[data-pbe-owner-close]");
    const actionRefreshButton = root.querySelector("[data-pbe-owner-action-refresh]");
    const lifecycle = root.querySelector("[data-pbe-owner-lifecycle]");
    const authoritative = root.querySelector("[data-pbe-owner-authoritative]");
    const projection = root.querySelector("[data-pbe-owner-projection]");
    const publication = root.querySelector("[data-pbe-owner-publication]");
    const layerHelp = root.querySelector("[data-pbe-owner-layer-help]");
    const retryError = root.querySelector("[data-pbe-owner-retry-error]");
    const retryButton = root.querySelector("[data-pbe-owner-retry]");
    if (title) title.textContent = state.ready
      ? `PBE Owner · ${state.session?.fixtureBreadcrumb || state.session?.fixtureId || "frozen fixture"}`
      : state.phase === "checking"
        ? "Loading PBE Owner"
        : "PBE Owner unavailable";
    if (message) message.textContent = state.message;
    root.title = state.message;
    if (closeButton) {
      closeButton.hidden = !state.session;
      closeButton.disabled = state.phase === "closing";
    }
    root.dataset.pendingState = state.pendingAction?.state || "";
    root.setAttribute?.(
      "aria-busy",
      state.phase === "checking" || state.pendingAction || state.pendingActionRefreshing || state.lifecycleRetrying
        ? "true"
        : "false",
    );
    if (actionRefreshButton) {
      actionRefreshButton.hidden = !state.pendingAction;
      actionRefreshButton.disabled = state.pendingActionRefreshing;
      actionRefreshButton.textContent = state.pendingActionRefreshing
        ? "Refreshing action status…"
        : "Refresh action status";
    }
    if (lifecycle) {
      lifecycle.hidden = !state.lifecycle;
      lifecycle.dataset.projectionState = state.lifecycle?.projection?.state || "";
      lifecycle.setAttribute?.("aria-busy", state.lifecycleRetrying ? "true" : "false");
    }
    const copy = lifecycleCopy(state.lifecycle);
    if (authoritative) authoritative.textContent = copy.authoritative;
    if (projection) projection.textContent = copy.projection;
    if (publication) publication.textContent = copy.publication;
    if (layerHelp) layerHelp.textContent = copy.help;
    if (retryError) {
      retryError.textContent = state.lifecycleRetryError;
      retryError.hidden = !state.lifecycleRetryError;
    }
    if (retryButton) {
      retryButton.hidden = !state.lifecycle?.projectionRetry?.available;
      retryButton.disabled = state.lifecycleRetrying;
      retryButton.textContent = state.lifecycleRetrying ? "Retrying local projection…" : "Retry local projection";
    }
  };

  const failClosed = (error) => {
    sessionGeneration += 1;
    window.clearInterval(heartbeatTimer);
    heartbeatTimer = 0;
    browserTicket = "";
    clearPendingAction();
    const detail = error?.message || "PBE Owner session is unavailable.";
    const message = /(?:backstage|reopen|closed)/i.test(detail)
      ? detail
      : `${detail} Reopen PBE Owner from Backstage to retry.`;
    update({
      phase: "unavailable",
      ready: false,
      session: null,
      message,
      lifecycle: null,
      lifecycleRetrying: false,
      lifecycleRetryError: "",
      pendingAction: null,
      pendingActionRefreshing: false,
      pendingActionError: "",
    });
  };

  const heartbeat = async () => {
    const generation = sessionGeneration;
    if (!state.ready || state.phase !== "ready" || !state.session) return publicState();
    try {
      const payload = await request("/session/heartbeat", { method: "POST" });
      if (generation !== sessionGeneration || state.phase !== "ready" || !state.session) {
        return publicState();
      }
      const latestActionReported = Object.prototype.hasOwnProperty.call(payload, "latestAction");
      const hadPending = Boolean(state.pendingAction);
      const actionSnapshot = latestActionReported
        ? actionStatusSnapshot(payload.latestAction, payload.session, null)
        : {
          message: state.pendingAction
            ? pendingActionMessage(state.pendingAction, state.pendingActionError)
            : readyMessage(payload.session),
        };
      update({
        ...actionSnapshot,
        phase: "ready",
        ready: true,
        session: payload.session,
      });
      if (
        latestActionReported
        && hadPending
        && actionStatusState(payload.latestAction) === "completed"
      ) {
        window.dispatchEvent(new CustomEvent("photosbyelie:pbeowneractionresult", { detail: payload.latestAction }));
      }
    } catch (error) {
      if (generation !== sessionGeneration) return publicState();
      failClosed(error);
    }
    return publicState();
  };

  const verifiedLifecycleResult = async (requestId, session = state.session) => {
    const latest = await request(`/action/status?requestId=${encodeURIComponent(requestId)}`);
    const lifecycle = normalizedLifecycleResult(latest);
    if (lifecycle) writeLifecycleResult(lifecycle, session);
    else clearLifecycleResult(session);
    return lifecycle;
  };

  const lifecycleWithoutRetry = (lifecycle) => lifecycle ? {
    ...lifecycle,
    projectionRetry: {
      ...(lifecycle.projectionRetry || {}),
      available: false,
      token: "",
    },
  } : null;

  const bootstrap = async () => {
    if (!localHost || !ownerSurface) return publicState();
    const generation = ++sessionGeneration;
    update({
      phase: "checking",
      ready: false,
      message: "Loading the frozen Backstage fixture and preparing its gallery…",
    });
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
      if (generation !== sessionGeneration) return publicState();
      let persistedLifecycle = readLifecycleResult(payload.session);
      let pendingAction = readPendingAction(payload.session);
      let pendingActionError = "";
      let message = readyMessage(payload.session);
      const latestActionReported = Object.prototype.hasOwnProperty.call(payload, "latestAction");
      if (latestActionReported) {
        const snapshot = actionStatusSnapshot(payload.latestAction, payload.session, null);
        persistedLifecycle = snapshot.lifecycle;
        pendingAction = snapshot.pendingAction;
        pendingActionError = snapshot.pendingActionError;
        message = snapshot.message;
      } else if (pendingAction?.requestId) {
        try {
          const pendingStatus = await request(
            `/action/status?requestId=${encodeURIComponent(pendingAction.requestId)}`,
          );
          const snapshot = actionStatusSnapshot(pendingStatus, payload.session, persistedLifecycle);
          persistedLifecycle = snapshot.lifecycle;
          pendingAction = snapshot.pendingAction;
          pendingActionError = snapshot.pendingActionError;
          message = snapshot.message;
        } catch (error) {
          if ([401, 403].includes(error?.status)) throw error;
          pendingActionError = error?.message || "Action status is temporarily unavailable.";
          message = pendingActionMessage(pendingAction, pendingActionError);
        }
      } else if (persistedLifecycle?.requestId) {
        try {
          persistedLifecycle = await verifiedLifecycleResult(
            persistedLifecycle.requestId,
            payload.session,
          );
        } catch (error) {
          if ([401, 403].includes(error?.status)) throw error;
          clearLifecycleResult(payload.session);
          persistedLifecycle = null;
        }
      }
      update({
        phase: "ready",
        ready: true,
        session: payload.session,
        message,
        lifecycle: persistedLifecycle,
        lifecycleRetrying: false,
        lifecycleRetryError: "",
        pendingAction,
        pendingActionRefreshing: false,
        pendingActionError,
      });
      heartbeatTimer = window.setInterval(heartbeat, 30_000);
    } catch (error) {
      if (generation !== sessionGeneration) return publicState();
      failClosed(error);
    }
    return publicState();
  };

  const action = async (operation, payload = {}) => {
    if (!state.ready || !state.session) {
      throw new Error(state.message || "PBE Owner session is not ready.");
    }
    if (state.pendingAction) {
      const pendingStatus = await refreshPendingAction();
      if (["queued", "running"].includes(actionStatusState(pendingStatus))) {
        throw new Error("A previous PBE Owner action is still safely queued. No new action was sent.");
      }
      if (["failed", "blocked"].includes(actionStatusState(pendingStatus))) {
        throw new Error(actionFailureMessage(pendingStatus));
      }
    }
    const actionPayload = { action: operation };
    const photoId = String(payload?.photo_id || payload?.photoId || "").trim();
    const photoIds = Array.isArray(payload?.photo_ids || payload?.photoIds)
      ? (payload.photo_ids || payload.photoIds).map((value) => String(value || "").trim()).filter(Boolean)
      : [];
    if (photoId) actionPayload.photo_id = photoId;
    if (photoIds.length) actionPayload.photo_ids = photoIds;
    if (String(payload?.reason || "").trim()) actionPayload.reason = String(payload.reason).trim();
    const response = await fetch(`${localBase}/action`, {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Idempotency-Key": `pbe-owner-${Date.now().toString(36)}-${crypto.randomUUID()}`,
      },
      body: JSON.stringify(actionPayload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result?.ok) {
      const detail = result?.error;
      if ([401, 403, 409].includes(response.status)) failClosed(new Error(detail?.message || "PBE Owner authorization ended."));
      throw new Error(detail?.message || detail || `PBE Owner action failed: ${operation}`);
    }
    if (!["queued", "running"].includes(result.state) || !result.requestId) {
      return applyActionStatus(result);
    }
    applyActionStatus(result);
    if (result.resumed) {
      const resumedStatus = await refreshPendingAction();
      const detail = ["failed", "blocked"].includes(actionStatusState(resumedStatus))
        ? actionFailureMessage(resumedStatus)
        : "A previous PBE Owner action was already active. No new action was sent.";
      throw new Error(detail);
    }
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 250));
      let status;
      try {
        status = await request(`/action/status?requestId=${encodeURIComponent(result.requestId)}`);
      } catch (error) {
        if ([401, 403].includes(error?.status)) failClosed(error);
        throw error;
      }
      if (["queued", "running"].includes(actionStatusState(status))) {
        applyActionStatus(status);
        continue;
      }
      applyActionStatus(status);
      if (["failed", "blocked"].includes(actionStatusState(status))) {
        throw new Error(actionFailureMessage(status));
      }
      return status;
    }
    throw new Error("PBE Owner action remains safely queued for the trusted Mac connector.");
  };

  const retryProjection = async () => {
    const lifecycle = state.lifecycle;
    const retry = lifecycle?.projectionRetry;
    if (!state.ready || !state.session) {
      throw new Error(state.message || "PBE Owner session is not ready.");
    }
    if (!retry?.available) {
      const error = new Error("This lifecycle projection is not retryable.");
      update({ lifecycleRetrying: false, lifecycleRetryError: error.message });
      throw error;
    }
    update({ lifecycleRetrying: true, lifecycleRetryError: "" });
    try {
      const result = await request("/action/projection-retry", {
        method: "POST",
        body: {
          requestId: lifecycle.requestId,
          projectionToken: retry.token,
          operationRevision: retry.operationRevision,
        },
      });
      recordLifecycleResult(result);
      return result;
    } catch (error) {
      if ([401, 403].includes(error?.status)) {
        failClosed(error);
      } else if (error?.status === 409 && lifecycle?.requestId) {
        try {
          const refreshed = await verifiedLifecycleResult(lifecycle.requestId);
          update({
            lifecycle: refreshed || lifecycleWithoutRetry(lifecycle),
            lifecycleRetrying: false,
            lifecycleRetryError: error?.message || "Projection state changed; review the latest status.",
          });
        } catch (refreshError) {
          if ([401, 403].includes(refreshError?.status)) {
            failClosed(refreshError);
          } else {
            const disabled = lifecycleWithoutRetry(lifecycle);
            writeLifecycleResult(disabled);
            update({
              lifecycle: disabled,
              lifecycleRetrying: false,
              lifecycleRetryError: error?.message || "Projection retry is unavailable until status refreshes.",
            });
          }
        }
      } else {
        update({ lifecycleRetrying: false, lifecycleRetryError: error?.message || "Projection retry failed." });
      }
      throw error;
    }
  };

  const close = async () => {
    if (!state.session) return;
    sessionGeneration += 1;
    window.clearInterval(heartbeatTimer);
    heartbeatTimer = 0;
    update({ phase: "closing", ready: false, message: "Closing the fixture lease…" });
    try {
      await request("/session/close", { method: "POST" }).catch(() => null);
    } finally {
      failClosed(new Error("PBE Owner session closed. Reopen it from Backstage to act again."));
    }
  };

  const pageReady = async () => {
    if (ownerSurface) {
      await window.photosByEliePBEOwnerSessionReady;
      await window.photosByElieHiddenActionsReady;
      const gallery = window.photosByElieData?.[galleryKey];
      if (!state.ready || !state.session || !gallery) {
        const error = new Error(state.message || "PBE Owner session is unavailable.");
        error.code = "pbe_owner_page_unavailable";
        throw error;
      }
      return { mode: "pbe-owner", galleryKey, gallery };
    }
    await window.photosByElieCatalogReady;
    await window.photosByElieSharedGalleryReady;
    await window.photosByElieHiddenActionsReady;
    return { mode: "public", galleryKey: "", gallery: null };
  };

  browserTicket = consumeFragment();
  window.photosByEliePBEOwnerSession = {
    action,
    bootstrap,
    close,
    isReady: () => state.ready,
    recordLifecycleResult,
    refreshPendingAction,
    retryProjection,
    state: publicState,
  };
  window.photosByEliePBEOwnerSessionReady = bootstrap();
  window.photosByEliePageReady = pageReady;
})();
