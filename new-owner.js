(() => {
  const cleanBase = (value) => String(value || "").trim().replace(/\/+$/, "");
  const mediaConfig = window.photosByElieMediaConfig || {};
  const workerBase = cleanBase(mediaConfig.authWorkerBaseUrl || mediaConfig.checkoutWorkerBaseUrl || "");
  const AUTH_TOKEN_HASH_PARAM = "pbe_auth_token";
  const AUTH_TOKEN_STORAGE_KEY = "pbe-new-owner-auth-token";
  const state = {
    session: null,
    access: null,
    action: null,
    actions: [],
    connectors: [],
    review: null,
    reviewPage: "culling",
    reviewSelectedAssetId: "",
    busy: false,
  };
  const lanes = [
    { label: "Identity and roles", state: "live", detail: "Google session, D1 access registry, ACS policy tester" },
    { label: "Owner action queue", state: "live", detail: "Authenticated browser requests with connector claim/complete audit" },
    { label: "Real Estate outputs", state: "mixed", detail: "Cloud PDF/video storage with local source import still pending" },
    { label: "Apple Photos import", state: "mixed", detail: "Cloud controlled; PhotoKit work runs on an enrolled Mac connector" },
    { label: "Sidecar culling", state: "live", detail: "Cloud review windows and decisions with connector-backed Photos previews" },
  ];

  const $ = (selector) => document.querySelector(selector);
  const root = $("[data-new-owner-root]");
  const statusRoot = $("[data-new-owner-status]");
  const sessionRoot = $("[data-new-owner-session]");
  const accessRoot = $("[data-new-owner-access]");
  const lanesRoot = $("[data-new-owner-lanes]");
  const connectorsRoot = $("[data-new-owner-connectors]");
  const actionRoot = $("[data-new-owner-action]");
  const reviewRoot = $("[data-new-owner-review]");
  const actionStatusRoot = $("[data-new-owner-action-status]");
  const connectorInput = $("[data-new-owner-connector]");
  const workerBaseRoot = $("[data-new-owner-worker-base]");
  const connectorDownload = $("[data-new-owner-download-connector]");

  const setStatus = (message) => {
    if (statusRoot) statusRoot.textContent = message;
  };

  const setActionStatus = (message, stateName = "") => {
    if (!actionStatusRoot) return;
    actionStatusRoot.textContent = message;
    actionStatusRoot.dataset.state = stateName;
  };

  const setQueueControlsBusy = (busy) => {
    document.querySelectorAll("[data-new-owner-queue-check], [data-new-owner-sync-photos], [data-new-owner-queue-sidecar], [data-new-owner-upload-publish]")
      .forEach((button) => {
        button.disabled = busy;
        button.setAttribute("aria-busy", String(busy));
      });
  };

  const queueErrorMessage = (error) => {
    const message = String(error?.message || "Could not queue Owner action.");
    if (/KV put\(\) limit exceeded/i.test(message)) {
      return "Cloud queue unavailable: Cloudflare's KV write limit is exhausted. Try again after 00:00 UTC or enable Workers Paid.";
    }
    return message;
  };

  const escapeHtml = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const apiUrl = (path) => workerBase ? `${workerBase}${path}` : path;

  const storedAuthToken = () => {
    try {
      return sessionStorage.getItem(AUTH_TOKEN_STORAGE_KEY) || "";
    } catch {
      return "";
    }
  };

  const storeAuthToken = (token) => {
    try {
      if (token) sessionStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
      else sessionStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    } catch {
      // Session transfer is a Safari/local convenience; cookie auth can still work.
    }
  };

  const absorbAuthTokenFromHash = () => {
    const hash = window.location.hash ? window.location.hash.slice(1) : "";
    if (!hash) return;
    const params = new URLSearchParams(hash);
    const token = params.get(AUTH_TOKEN_HASH_PARAM) || "";
    if (!token) return;
    storeAuthToken(token);
    params.delete(AUTH_TOKEN_HASH_PARAM);
    const preservedHash = params.get("pbe_return_hash") || "";
    params.delete("pbe_return_hash");
    const nextHash = params.toString() || preservedHash;
    const nextUrl = `${window.location.pathname}${window.location.search}${nextHash ? `#${nextHash}` : ""}`;
    window.history.replaceState(null, "", nextUrl);
  };

  const apiFetch = async (path, options = {}) => {
    const token = storedAuthToken();
    const response = await fetch(apiUrl(path), {
      credentials: "include",
      cache: "no-store",
      ...options,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok === false || body?.error) {
      throw new Error(body?.error?.message || body?.error || `NewOwner request failed with HTTP ${response.status}.`);
    }
    return body;
  };

  const countNode = (key) => $(`[data-new-owner-count="${key}"]`);

  const setCount = (key, value) => {
    const node = countNode(key);
    if (node) node.textContent = String(value);
  };

  const ownerAllowed = () => {
    const roles = Array.isArray(state.session?.roles) ? state.session.roles : [];
    return state.session?.admin === true || state.session?.tier === "owner" || roles.includes("owner") || roles.includes("admin");
  };

  const cleanConnectorId = (value) => String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  const connectorId = () => cleanConnectorId(connectorInput?.value || "");

  const rememberConnector = () => {
    if (!connectorInput) return;
    connectorInput.value = cleanConnectorId(connectorInput.value || "");
    try {
      localStorage.setItem("pbe-new-owner-connector", connectorInput.value);
    } catch {
      // Connector naming is local UI convenience.
    }
  };

  const renderSession = () => {
    if (!sessionRoot) return;
    const session = state.session;
    if (!session?.authenticated) {
      sessionRoot.innerHTML = `<strong>Signed out</strong><br><small>Use Google sign-in to open cloud Owner.</small>`;
      setCount("owner", "locked");
      return;
    }
    const roles = (session.roles || []).join(", ");
    sessionRoot.innerHTML = `
      <strong>${escapeHtml(session.user?.email || "")}</strong><br>
      <small>${escapeHtml(roles || "user")}${session.admin ? " / bootstrap admin" : ""}</small>
    `;
    setCount("owner", ownerAllowed() ? "open" : "locked");
  };

  const renderCounts = () => {
    const access = state.access || {};
    const people = Array.isArray(access.people) ? access.people : [];
    const groups = Array.isArray(access.audienceGroups) ? access.audienceGroups : [];
    setCount("people", people.length);
    setCount("groups", groups.filter((group) => group.state !== "archived").length);
    setCount("fixtures", people.filter((user) => user.fixture).length);
    setCount("action", state.actions.length);
    setCount("connector", state.connectors.length);
  };

  const chip = (label, modifier = "") =>
    `<span class="new-owner-chip ${modifier ? `is-${escapeHtml(modifier)}` : ""}">${escapeHtml(label)}</span>`;

  const renderActionResultChips = (action) => {
    const result = action?.result || {};
    const chips = [];
    if (result.readOnly) chips.push(chip("read-only", "local"));
    if (Number.isFinite(result.recordsPrepared)) chips.push(chip(`${result.recordsPrepared} prepared`, "live"));
    if (Number.isFinite(result.candidateCount)) chips.push(chip(`${result.candidateCount} candidates`));
    if (result.local?.machineNames?.length) chips.push(chip(result.local.machineNames[0], "planned"));
    if (Number.isFinite(result.runCount)) chips.push(chip(`${result.runCount} uploaded`, "live"));
    if (Number.isFinite(result.registration?.registeredCount)) chips.push(chip(`${result.registration.registeredCount} cataloged`, "live"));
    if (Number.isFinite(result.job?.indexedCount)) chips.push(chip(`${result.job.indexedCount} Photos indexed`, "live"));
    if (result.job?.status) chips.push(chip(`Photos ${result.job.status}`, result.job.status === "done" ? "live" : "planned"));
    return chips.join("");
  };

  const reviewAction = (actionId, label) =>
    `<button class="btn secondary" type="button" data-new-owner-action-command="open-review" data-action-id="${escapeHtml(actionId)}">${escapeHtml(label)}</button>`;

  const actionTime = (action) => {
    const timestamp = Date.parse(action?.createdAt || action?.updatedAt || "");
    return Number.isFinite(timestamp) ? timestamp : 0;
  };

  const mergeActions = (actions = [], preferredAction = state.action) => {
    const byId = new Map();
    if (preferredAction?.id) byId.set(preferredAction.id, preferredAction);
    for (const action of actions) {
      if (action?.id && !byId.has(action.id)) byId.set(action.id, action);
    }
    return [...byId.values()].sort((left, right) => actionTime(right) - actionTime(left));
  };

  const renderAccess = () => {
    if (!accessRoot) return;
    if (!state.access) {
      accessRoot.innerHTML = `<p class="new-owner-empty">Access state is waiting for an Admin cloud session.</p>`;
      return;
    }
    const groups = Array.isArray(state.access.audienceGroups) ? state.access.audienceGroups : [];
    const people = Array.isArray(state.access.people) ? state.access.people : [];
    const liveGroups = groups.filter((group) => group.state !== "archived").slice(0, 5);
    const owners = people.filter((user) => (user.roles || []).includes("owner") && !user.disabledAt);
    const reClients = people.filter((user) =>
      ((user.roles || []).includes("re_client") || (user.realEstateClients || []).length)
      && !user.disabledAt
    );
    accessRoot.innerHTML = [
      {
        title: "Owner identities",
        detail: `${owners.length} active owner${owners.length === 1 ? "" : "s"}`,
        chips: owners.map((user) => user.email),
        state: "live",
      },
      {
        title: "Real Estate clients",
        detail: `${reClients.length} active RE client${reClients.length === 1 ? "" : "s"}`,
        chips: reClients.map((user) => user.email),
        state: "live",
      },
      ...liveGroups.map((group) => ({
        title: group.label || group.id,
        detail: [group.kind, group.galleryKind, group.galleryKey].filter(Boolean).join(" / "),
        chips: group.capabilities || [],
        state: group.fixture ? "planned" : "live",
      })),
    ].map((row) => `
      <article class="new-owner-access-row">
        <div>
          <strong>${escapeHtml(row.title)}</strong><br>
          <small>${escapeHtml(row.detail)}</small>
        </div>
        <div class="new-owner-chip-stack">
          ${(row.chips || []).slice(0, 6).map((item) => chip(item)).join("") || chip("none", "planned")}
        </div>
        ${chip(row.state, row.state)}
      </article>
    `).join("");
  };

  const renderLanes = () => {
    if (!lanesRoot) return;
    lanesRoot.innerHTML = lanes.map((lane) => {
      const modifier = lane.state === "live" ? "live" : (lane.state === "local" ? "local" : "planned");
      return `
        <article class="new-owner-lane-row">
          <div>
            <strong>${escapeHtml(lane.label)}</strong><br>
            <small>${escapeHtml(lane.detail)}</small>
          </div>
          ${chip(lane.state, modifier)}
        </article>
      `;
    }).join("");
  };

  const renderConnectors = () => {
    if (!connectorsRoot) return;
    if (!state.connectors.length) {
      connectorsRoot.innerHTML = `<p class="new-owner-empty">No Mac connector has checked in yet.</p>`;
      return;
    }
    connectorsRoot.innerHTML = state.connectors.map((connector) => {
      const age = Date.now() - Date.parse(connector.lastSeenAt || "");
      const online = Number.isFinite(age) && age < 2 * 60 * 1000;
      return `
        <article class="new-owner-lane-row">
          <div>
            <strong>${escapeHtml(connector.id || "Mac connector")}</strong><br>
            <small>${escapeHtml([connector.hostname, connector.platform, connector.version].filter(Boolean).join(" / "))}</small>
          </div>
          ${chip(online ? "online" : "last seen", online ? "live" : "planned")}
        </article>
      `;
    }).join("");
  };

  const renderAction = () => {
    if (!actionRoot) return;
    const actions = state.actions.length ? state.actions : (state.action?.id ? [state.action] : []);
    if (!actions.length) {
      actionRoot.innerHTML = `<p class="new-owner-empty">No recent cloud Owner actions.</p>`;
      return;
    }
    const readyReview = actions.find((action) => action.state === "completed" && action.type === "sidecar-culling-review");
    actionRoot.innerHTML = `
      ${readyReview ? `<div class="new-owner-ready-review">${reviewAction(readyReview.id, "Open culling review")}</div>` : ""}
      ${actions.map((action) => `
      <article class="new-owner-action-row" data-action-id="${escapeHtml(action.id)}">
        <strong>${escapeHtml(action.type || "owner action")}</strong>
        <small>${escapeHtml(action.id)}</small>
        <div class="new-owner-chip-stack">
          ${chip(action.state || "queued", action.state === "failed" ? "local" : (action.state === "claimed" ? "planned" : "live"))}
          ${action.createdAt ? chip(action.createdAt) : ""}
          ${action.claim?.connectorId ? chip(action.claim.connectorId, "planned") : ""}
          ${action.completedAt ? chip(action.completedAt, "live") : ""}
          ${action.error?.message ? chip(action.error.message, "local") : ""}
          ${renderActionResultChips(action)}
        </div>
        <div class="new-owner-action-row-controls">
          ${action.state === "completed" && action.type === "sidecar-culling-review" ? reviewAction(action.id, "Open review") : ""}
          ${["queued", "claimed"].includes(action.state) ? `<button class="btn secondary" type="button" data-new-owner-action-command="fail" data-action-id="${escapeHtml(action.id)}">Fail</button>` : ""}
        </div>
      </article>
      `).join("")}
    `;
  };

  const itemTitle = (item) => item.title || item.filename || item.assetId || "Sidecar item";

  const reviewItemChips = (item) => [
    item.mediaType ? chip(item.mediaType) : "",
    chip(item.pickState || "undecided", item.pickState === "rejected" ? "local" : (item.pickState === "picked" ? "live" : "planned")),
    item.metadataState ? chip(item.metadataState) : "",
    Number.isFinite(item.rating) ? chip(`${item.rating} star${item.rating === 1 ? "" : "s"}`) : "",
    item.color ? chip(item.color) : "",
    item.pendingSyncCount ? chip(`${item.pendingSyncCount} pending`, "local") : "",
  ].filter(Boolean).join("");

  const reviewCommandButton = (item, action, label) => {
    const active = (action === "pick" && item.pickState === "picked")
      || (action === "unpick" && (!item.pickState || item.pickState === "undecided"))
      || (action === "reject" && item.pickState === "rejected");
    return `
      <button
        class="btn secondary ${active ? "is-active" : ""}"
        type="button"
        data-new-owner-review-command="${escapeHtml(action)}"
        data-asset-id="${escapeHtml(item.assetId)}"
        aria-pressed="${active ? "true" : "false"}"
      >${escapeHtml(label)}</button>
    `;
  };

  const reviewRatingButtons = (item) => [0, 1, 2, 3, 4, 5].map((rating) => `
    <button
      class="new-owner-rating-button ${Number(item.rating || 0) === rating ? "is-active" : ""}"
      type="button"
      data-new-owner-review-command="rating"
      data-rating="${rating}"
      data-asset-id="${escapeHtml(item.assetId)}"
      aria-label="${rating ? `${rating} stars` : "Clear stars"}"
    >${rating || "×"}</button>
  `).join("");

  const reviewItemById = (assetId) => (state.review?.items || []).find((item) => item.assetId === assetId) || null;

  const selectedReviewItem = () => reviewItemById(state.reviewSelectedAssetId)
    || state.review?.items?.[0]
    || null;

  const selectReviewItem = (assetId) => {
    if (!reviewItemById(assetId)) return;
    state.reviewSelectedAssetId = assetId;
    renderReview();
  };

  const setReviewPage = (page) => {
    state.reviewPage = page === "review" ? "review" : "culling";
    renderReview();
  };

  const reviewTab = (page, label) => `
    <button
      class="btn secondary ${state.reviewPage === page ? "is-active" : ""}"
      type="button"
      data-new-owner-review-page="${page}"
      aria-pressed="${state.reviewPage === page ? "true" : "false"}"
    >${label}</button>
  `;

  const renderCullingCard = (item) => {
    const selected = item.assetId === selectedReviewItem()?.assetId;
    return `
      <article class="new-owner-culling-card ${selected ? "is-selected" : ""}" data-review-asset-id="${escapeHtml(item.assetId)}" tabindex="0" aria-selected="${selected ? "true" : "false"}">
        <div class="new-owner-culling-preview">
          ${item.previewDataUrl
            ? `<img src="${escapeHtml(item.previewDataUrl)}" alt="${escapeHtml(itemTitle(item))}" loading="lazy"/>`
            : `<span>${escapeHtml(item.previewError || "Preview unavailable")}</span>`}
        </div>
        <div class="new-owner-culling-card-main">
          <strong>${escapeHtml(itemTitle(item))}</strong>
          <small>${escapeHtml([item.filename, item.capturedAt || item.indexedAt].filter(Boolean).join(" / "))}</small>
          <div class="new-owner-chip-stack">${reviewItemChips(item)}</div>
        </div>
        <div class="new-owner-culling-card-controls">
          <div class="new-owner-rating-row">${reviewRatingButtons(item)}</div>
          ${reviewCommandButton(item, "pick", "Pick")}
          ${reviewCommandButton(item, "unpick", "Unpick")}
          ${reviewCommandButton(item, "reject", "Reject")}
        </div>
      </article>
    `;
  };

  const renderMetadataReviewRow = (item) => `
    <article class="new-owner-review-row ${item.assetId === selectedReviewItem()?.assetId ? "is-selected" : ""}" data-review-asset-id="${escapeHtml(item.assetId)}" tabindex="0" aria-selected="${item.assetId === selectedReviewItem()?.assetId ? "true" : "false"}">
      <div class="new-owner-review-preview">
        ${item.previewDataUrl
          ? `<img src="${escapeHtml(item.previewDataUrl)}" alt="${escapeHtml(itemTitle(item))}" loading="lazy"/>`
          : `<span>${escapeHtml(item.previewError || "Preview unavailable")}</span>`}
      </div>
      <div class="new-owner-review-row-main">
        <strong>${escapeHtml(itemTitle(item))}</strong>
        <small>${escapeHtml([item.filename, item.assetId].filter(Boolean).join(" / "))}</small>
        <small>${escapeHtml(item.capturedAt || item.indexedAt || "")}</small>
        <label><span>Title</span><input type="text" data-review-title value="${escapeHtml(item.title || "")}"/></label>
        <label><span>Keywords</span><textarea rows="2" data-review-keywords>${escapeHtml((item.keywords || []).join(", "))}</textarea></label>
      </div>
      <div class="new-owner-chip-stack">${reviewItemChips(item)}</div>
      <div class="new-owner-review-row-controls">
        ${reviewCommandButton(item, "unpick", "Unpick")}
        ${reviewCommandButton(item, "reject", "Reject")}
        ${reviewCommandButton(item, "approve", "Approve metadata")}
      </div>
    </article>
  `;

  const renderReview = () => {
    if (!reviewRoot) return;
    const review = state.review;
    if (!review) {
      reviewRoot.hidden = true;
      reviewRoot.innerHTML = "";
      return;
    }
    const items = Array.isArray(review.items) ? review.items : [];
    const result = review.result || {};
    if (!reviewItemById(state.reviewSelectedAssetId)) state.reviewSelectedAssetId = items[0]?.assetId || "";
    const pickedItems = items.filter((item) => item.pickState === "picked");
    const showingReview = state.reviewPage === "review";
    reviewRoot.hidden = false;
    reviewRoot.innerHTML = `
      <div class="owner-card-titlebar">
        <div>
          <p class="eyebrow">Sidecar</p>
          <h2>${showingReview ? "Title and keywords review" : "Culling gallery"}</h2>
        </div>
        <div class="new-owner-review-summary">
          ${chip(`${items.length} shown`, "live")}
          ${Number.isFinite(result.candidateCount) ? chip(`${result.candidateCount} candidates`) : ""}
          ${Number.isFinite(result.indexedCount) ? chip(`${result.indexedCount} indexed`) : ""}
          ${result.readOnly ? chip("opened read-only", "local") : ""}
        </div>
      </div>
      <div class="new-owner-review-meta">
        <strong>${escapeHtml(review.actionId || "sidecar-culling-review")}</strong>
        <span>${escapeHtml(result.local?.ownerDb || "Owner.sqlite")}</span>
      </div>
      <div class="new-owner-review-toolbar" aria-label="Sidecar workflow">
        ${reviewTab("culling", "Culling")}
        ${reviewTab("review", `Title & keywords (${pickedItems.length})`)}
        <span>Press <kbd>C</kbd> to switch</span>
      </div>
      ${showingReview
        ? `<div class="new-owner-review-list">${pickedItems.map(renderMetadataReviewRow).join("") || `<p class="new-owner-empty">Pick photos in Culling before starting title and keywords review.</p>`}</div>`
        : `<div class="new-owner-culling-grid">${items.map(renderCullingCard).join("") || `<p class="new-owner-empty">No Sidecar records in this culling window.</p>`}</div>`}
    `;
  };

  const render = () => {
    renderSession();
    renderCounts();
    renderAccess();
    renderLanes();
    renderConnectors();
    renderAction();
    renderReview();
    prepareCollapsibleSections();
  };

  const prepareCollapsibleSections = () => {
    document.querySelectorAll(".new-owner-card").forEach((card) => {
      if (card.dataset.collapsibleReady === "true") return;
      const titlebar = [...card.children].find((child) => child.classList.contains("owner-card-titlebar"));
      if (!titlebar) return;
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      const content = document.createElement("div");
      const isPrimaryAction = card.getAttribute("aria-label") === "Owner action queue";
      const isReview = card.classList.contains("new-owner-review-card");

      details.className = "new-owner-card-details";
      details.open = !window.matchMedia("(max-width: 900px)").matches || isPrimaryAction || isReview;
      summary.className = "new-owner-card-summary";
      content.className = "new-owner-card-content";
      summary.append(titlebar);
      summary.insertAdjacentHTML("beforeend", '<span class="new-owner-card-toggle" aria-hidden="true"></span>');
      [...card.children].forEach((child) => content.append(child));
      details.append(summary, content);
      card.append(details);
      card.dataset.collapsibleReady = "true";
    });
  };

  const loadActions = async () => {
    const body = await apiFetch("/owner/actions?limit=8");
    state.actions = mergeActions(Array.isArray(body.actions) ? body.actions : []);
    state.action = state.actions[0] || state.action;
  };

  const loadConnectors = async () => {
    const body = await apiFetch("/owner/connectors");
    state.connectors = Array.isArray(body.connectors) ? body.connectors : [];
  };

  const load = async () => {
    if (workerBaseRoot) workerBaseRoot.textContent = workerBase || "same-origin Worker";
    setStatus("Loading cloud Owner state...");
    root?.classList.add("is-loading");
    try {
      const session = await apiFetch("/owner/session");
      state.session = session;
      if (ownerAllowed()) {
        try {
          state.access = await apiFetch("/access-console/state");
        } catch {
          state.access = null;
        }
        try {
          await loadActions();
        } catch {
          state.actions = state.action?.id ? [state.action] : [];
        }
        try {
          await loadConnectors();
        } catch {
          state.connectors = [];
        }
      }
      setStatus(ownerAllowed() ? "Cloud Owner session verified." : "Owner role is required.");
      if (connectorDownload && ownerAllowed() && workerBase) {
        connectorDownload.href = `${workerBase}/owner/connector/download/mac`;
        connectorDownload.hidden = false;
      }
    } catch (error) {
      state.session = null;
      state.access = null;
      state.actions = [];
      setStatus(error.message || "Cloud Owner is unavailable.");
    } finally {
      root?.classList.remove("is-loading");
      render();
    }
  };

  const login = () => {
    if (!workerBase) return;
    storeAuthToken("");
    const url = new URL(`${workerBase}/auth/google/login`);
    url.searchParams.set("returnTo", window.location.href);
    window.location.href = url.href;
  };

  const logout = () => {
    if (!workerBase) return;
    storeAuthToken("");
    const url = new URL(`${workerBase}/auth/logout`);
    url.searchParams.set("returnTo", window.location.href);
    window.location.href = url.href;
  };

  const queueAction = async ({ action, payload, statusLabel = "Queueing..." }) => {
    if (state.busy) return;
    state.busy = true;
    setQueueControlsBusy(true);
    setActionStatus(statusLabel, "busy");
    try {
      const body = await apiFetch("/owner/actions", {
        method: "POST",
        body: JSON.stringify({
          action,
          payload,
        }),
      });
      state.action = body.action || null;
      if (state.action?.id) {
        const readback = await apiFetch(`/owner/actions/${encodeURIComponent(state.action.id)}`);
        state.action = readback.action || state.action;
      }
      await loadActions();
      setActionStatus(state.action?.id ? "Queued — waiting for the selected Mac connector." : "", "success");
      setStatus("Owner action queued.");
      render();
    } catch (error) {
      const message = queueErrorMessage(error);
      setActionStatus(message, "error");
      setStatus(message);
    } finally {
      state.busy = false;
      setQueueControlsBusy(false);
    }
  };

  const queueCheck = () => queueAction({
    action: "owner-connector-check",
    payload: {
      requestedConnector: connectorId() || undefined,
      surface: "owner",
      checkedAt: new Date().toISOString(),
    },
    statusLabel: "Queueing...",
  });

  const queueSidecarCulling = () => queueAction({
    action: "sidecar-culling-review",
    payload: {
      surface: "new-owner",
      workflow: "sidecar-culling",
      connectorRequired: true,
      requestedConnector: connectorId(),
      localFilesRequired: true,
      manifest: {
        mode: "review-window",
        source: "owner-sqlite",
        limit: 24,
        includePreviews: true,
      },
      queuedAt: new Date().toISOString(),
    },
    statusLabel: "Starting culling...",
  });

  const queuePhotosIndexSync = () => queueAction({
    action: "sidecar-photos-index-sync",
    payload: {
      requestedConnector: connectorId() || undefined,
      queuedAt: new Date().toISOString(),
    },
    statusLabel: "Queueing Photos refresh...",
  });

  const queueUploadPublish = () => queueAction({
    action: "sidecar-upload-publish",
    payload: {
      requestedConnector: connectorId() || undefined,
      limit: 1,
      queuedAt: new Date().toISOString(),
    },
    statusLabel: "Queueing upload...",
  });

  const transitionAction = async (actionId, command) => {
    if (state.busy || !actionId || !command) return;
    state.busy = true;
    if (actionStatusRoot) actionStatusRoot.textContent = `${command[0].toUpperCase()}${command.slice(1)}...`;
    try {
      const payload = command === "claim"
        ? { connectorId: connectorId() }
        : command === "complete"
          ? { result: { connectorId: connectorId(), surface: "new-owner", completedAt: new Date().toISOString() } }
          : { message: `Marked failed from ${connectorId()} in NewOwner.` };
      const body = await apiFetch(`/owner/actions/${encodeURIComponent(actionId)}/${command}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      state.action = body.action || state.action;
      await loadActions();
      if (actionStatusRoot) actionStatusRoot.textContent = state.action?.state || "";
      setStatus(`Owner action ${state.action?.state || "updated"}.`);
      render();
    } catch (error) {
      if (actionStatusRoot) actionStatusRoot.textContent = "";
      setStatus(error.message || "Could not update Owner action.");
    } finally {
      state.busy = false;
    }
  };

  const reviewFromAction = (action) => ({
    actionId: action?.id || action?.result?.actionId || "",
    action,
    connector: action?.claim || null,
    result: action?.result || {},
    items: Array.isArray(action?.result?.previewItems) ? action.result.previewItems : [],
    stateCounts: Array.isArray(action?.result?.stateCounts) ? action.result.stateCounts : [],
  });

  const openReviewWorkspace = async (actionId) => {
    if (state.busy || !actionId) return;
    const action = state.actions.find((candidate) => candidate.id === actionId)
      || (state.action?.id === actionId ? state.action : null);
    if (!action?.id) {
      setStatus("Owner action is not loaded locally.");
      return;
    }
    state.busy = true;
    if (actionStatusRoot) actionStatusRoot.textContent = "Opening review...";
    try {
      state.review = reviewFromAction(action);
      state.reviewPage = "culling";
      state.reviewSelectedAssetId = state.review.items[0]?.assetId || "";
      if (actionStatusRoot) actionStatusRoot.textContent = "";
      setStatus(`Opened ${state.review.items.length} Sidecar records in Culling. Press C for Title and Keywords.`);
      render();
      reviewRoot?.scrollIntoView({ block: "start", behavior: "smooth" });
    } catch (error) {
      if (actionStatusRoot) actionStatusRoot.textContent = "";
      setStatus(error.message || "Could not open Sidecar review.");
    } finally {
      state.busy = false;
    }
  };

  const updateReviewItem = (assetId, decision) => {
    if (!state.review?.items?.length) return;
    state.review.items = state.review.items.map((item) => {
      if (item.assetId !== assetId) return item;
      const nextState = decision?.state || {};
      return {
        ...item,
        pickState: nextState.pickState || item.pickState,
        metadataState: nextState.metadataState || item.metadataState,
        rating: Number.isFinite(nextState.rating) ? nextState.rating : item.rating,
        color: nextState.color ?? item.color,
        title: nextState.title ?? item.title,
        keywords: Array.isArray(nextState.keywords) ? nextState.keywords : item.keywords,
        pendingSyncCount: decision?.pendingSyncCount ?? item.pendingSyncCount,
      };
    });
  };

  const waitForAction = async (actionId, timeoutMs = 90000) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const body = await apiFetch(`/owner/actions/${encodeURIComponent(actionId)}`);
      const action = body.action || {};
      if (["completed", "failed"].includes(action.state)) return action;
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
    }
    throw new Error("The Mac connector did not finish this decision in time.");
  };

  const recordReviewDecision = async (assetId, action, details = {}) => {
    if (state.busy || !assetId || !action) return;
    state.busy = true;
    try {
      const queued = await apiFetch("/owner/actions", {
        method: "POST",
        body: JSON.stringify({
          action: "sidecar-review-decision",
          payload: {
            assetId,
            decision: action,
            sourceActionId: state.review?.actionId || "",
            requestedConnector: state.review?.action?.claim?.connectorId || connectorId() || undefined,
            ...details,
          },
        }),
      });
      const finished = await waitForAction(queued.action?.id);
      if (finished.state === "failed") throw new Error(finished.error?.message || "The connector rejected this decision.");
      const decision = finished.result?.decision;
      updateReviewItem(assetId, decision);
      setStatus(`Staged ${action} for ${assetId}.`);
      renderReview();
    } catch (error) {
      setStatus(error.message || "Could not stage Sidecar decision.");
    } finally {
      state.busy = false;
    }
  };

  const hydrateConnector = () => {
    if (!connectorInput) return;
    try {
      connectorInput.value = cleanConnectorId(localStorage.getItem("pbe-new-owner-connector") || connectorInput.value || "");
    } catch {
      connectorInput.value = cleanConnectorId(connectorInput.value || "");
    }
  };

  $("[data-new-owner-refresh]")?.addEventListener("click", () => load());
  $("[data-new-owner-login]")?.addEventListener("click", login);
  $("[data-new-owner-logout]")?.addEventListener("click", logout);
  $("[data-new-owner-queue-check]")?.addEventListener("click", queueCheck);
  $("[data-new-owner-sync-photos]")?.addEventListener("click", queuePhotosIndexSync);
  $("[data-new-owner-queue-sidecar]")?.addEventListener("click", queueSidecarCulling);
  $("[data-new-owner-upload-publish]")?.addEventListener("click", queueUploadPublish);
  connectorInput?.addEventListener("change", rememberConnector);
  connectorInput?.addEventListener("blur", rememberConnector);
  actionRoot?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-new-owner-action-command]");
    if (!button) return;
    const command = button.getAttribute("data-new-owner-action-command");
    const actionId = button.getAttribute("data-action-id");
    if (command === "open-review") {
      openReviewWorkspace(actionId);
      return;
    }
    transitionAction(actionId, command);
  });
  reviewRoot?.addEventListener("click", (event) => {
    const pageButton = event.target.closest("[data-new-owner-review-page]");
    if (pageButton) {
      setReviewPage(pageButton.getAttribute("data-new-owner-review-page"));
      return;
    }
    const button = event.target.closest("[data-new-owner-review-command]");
    if (!button) {
      const row = event.target.closest("[data-review-asset-id]");
      if (row?.getAttribute("data-review-asset-id")) selectReviewItem(row.getAttribute("data-review-asset-id"));
      return;
    }
    const row = button.closest("[data-review-asset-id]");
    const command = button.getAttribute("data-new-owner-review-command");
    const assetId = button.getAttribute("data-asset-id");
    if (reviewItemById(assetId)) state.reviewSelectedAssetId = assetId;
    const details = command === "rating"
      ? { rating: Number(button.getAttribute("data-rating") || 0) }
      : command === "approve"
        ? {
          title: row?.querySelector("[data-review-title]")?.value || "",
          keywords: String(row?.querySelector("[data-review-keywords]")?.value || "").split(",").map((item) => item.trim()).filter(Boolean),
        }
        : {};
    recordReviewDecision(assetId, command, details);
  });
  document.addEventListener("keydown", (event) => {
    if (!state.review || state.busy || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const tag = String(event.target?.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    const key = event.key;
    const selected = selectedReviewItem();
    const claim = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (key === "c" || key === "C") {
      claim();
      setReviewPage(state.reviewPage === "culling" ? "review" : "culling");
      return;
    }
    if (!selected) return;
    if (/^[1-5]$/.test(key)) {
      claim();
      recordReviewDecision(selected.assetId, "rating", { rating: Number(key) });
    } else if (key === "0") {
      claim();
      recordReviewDecision(selected.assetId, "rating", { rating: 0 });
    } else if (key === "p" || key === "P") {
      claim();
      recordReviewDecision(selected.assetId, "pick");
    } else if (key === "u" || key === "U") {
      claim();
      recordReviewDecision(selected.assetId, "unpick");
    } else if (key === "x" || key === "X") {
      claim();
      recordReviewDecision(selected.assetId, "reject");
    } else if (key === "ArrowLeft" || key === "ArrowUp" || key === "ArrowRight" || key === "ArrowDown") {
      claim();
      const items = state.reviewPage === "review"
        ? (state.review.items || []).filter((item) => item.pickState === "picked")
        : (state.review.items || []);
      const currentIndex = Math.max(0, items.findIndex((item) => item.assetId === selected.assetId));
      const direction = key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1;
      const nextIndex = Math.min(items.length - 1, Math.max(0, currentIndex + direction));
      selectReviewItem(items[nextIndex]?.assetId || selected.assetId);
    }
  });
  absorbAuthTokenFromHash();
  hydrateConnector();
  renderLanes();
  load();
})();
