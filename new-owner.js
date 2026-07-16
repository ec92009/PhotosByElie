(() => {
  const cleanBase = (value) => String(value || "").trim().replace(/\/+$/, "");
  const mediaConfig = window.photosByElieMediaConfig || {};
  const workerBase = cleanBase(mediaConfig.authWorkerBaseUrl || mediaConfig.checkoutWorkerBaseUrl || "");
  const AUTH_TOKEN_HASH_PARAM = "pbe_auth_token";
  const AUTH_TOKEN_STORAGE_KEY = "pbe-new-owner-auth-token";
  const LEGACY_CONNECTOR_STORAGE_KEY = "pbe-new-owner-connector";
  const LOCAL_CONNECTOR_STATUS_URLS = [
    "http://localhost:8766/photosbyelie/connector-status",
    "http://127.0.0.1:8766/photosbyelie/connector-status",
  ];
  const LOCAL_SIDECAR_OPEN_URL = "http://127.0.0.1:8766/photosbyelie/open-sidecar";
  const RE_FIXTURE_STORAGE_KEY = "pbe-new-owner-re-fixture";
  const RE_PROJECT_STORAGE_KEY = "pbe-new-owner-re-project";
  const state = {
    session: null,
    access: null,
    action: null,
    actions: [],
    connectors: [],
    localConnector: null,
    localConnectorChecked: false,
    reAlbums: [],
    reSelectedAlbumIds: new Set(),
    rePreviewItems: [],
    reSelectedAssetIds: new Set(),
    busy: false,
  };
  const lanes = [
    { label: "Identity and roles", state: "live", detail: "Google session, D1 access registry, ACS policy tester" },
    { label: "Owner action queue", state: "live", detail: "Authenticated browser requests with connector claim/complete audit" },
    { label: "Real Estate outputs", state: "mixed", detail: "Cloud PDF/video storage with local source import still pending" },
    { label: "Apple Photos import", state: "mixed", detail: "Cloud controlled; PhotoKit work runs on an enrolled Mac connector" },
    { label: "Sidecar culling", state: "live", detail: "This Mac opens the exact local Culling and Review workspace" },
  ];

  const $ = (selector) => document.querySelector(selector);
  const root = $("[data-new-owner-root]");
  const statusRoot = $("[data-new-owner-status]");
  const sessionRoot = $("[data-new-owner-session]");
  const accessRoot = $("[data-new-owner-access]");
  const lanesRoot = $("[data-new-owner-lanes]");
  const connectorsRoot = $("[data-new-owner-connectors]");
  const actionRoot = $("[data-new-owner-action]");
  const actionStatusRoot = $("[data-new-owner-action-status]");
  const localConnectorRoot = $("[data-new-owner-local-connector]");
  const workerBaseRoot = $("[data-new-owner-worker-base]");
  const connectorDownload = $("[data-new-owner-download-connector]");
  const reFixtureInput = $("[data-new-owner-re-fixture]");
  const reProjectInput = $("[data-new-owner-re-project]");
  const reStatusRoot = $("[data-new-owner-re-status]");
  const reAlbumsRoot = $("[data-new-owner-re-albums]");
  const rePreviewRoot = $("[data-new-owner-re-preview]");

  const setStatus = (message) => {
    if (statusRoot) statusRoot.textContent = message;
  };

  const setActionStatus = (message, stateName = "") => {
    if (!actionStatusRoot) return;
    actionStatusRoot.textContent = message;
    actionStatusRoot.dataset.state = stateName;
  };

  const connectorLastSeenTime = (connector) => {
    const timestamp = Date.parse(connector?.lastSeenAt || "");
    return Number.isFinite(timestamp) ? timestamp : 0;
  };

  const isConnectorOnline = (connector) => {
    const timestamp = connectorLastSeenTime(connector);
    return timestamp > 0 && Date.now() - timestamp < 2 * 60 * 1000;
  };

  function syncOpenSidecarControl() {
    const button = $("[data-new-owner-queue-sidecar]");
    if (!button) return;
    button.disabled = state.busy;
    button.setAttribute("aria-disabled", String(state.busy));
    button.title = state.localConnectorChecked && !localConnectorId()
      ? "This browser could not verify localhost; click to try this Mac's local bridge directly."
      : "";
  }

  const setQueueControlsBusy = (busy) => {
    document.querySelectorAll("[data-new-owner-queue-check], [data-new-owner-sync-photos], [data-new-owner-queue-sidecar], [data-new-owner-upload-publish], [data-new-owner-re-load], [data-new-owner-re-preflight], [data-new-owner-re-assign]")
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

  const sleep = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

  const terminalActionStates = new Set(["completed", "failed", "cancelled"]);

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

  const connectorDisplayName = (value) => {
    const id = cleanConnectorId(value);
    if (!id) return "this Mac";
    return id.split(/[-_.]+/g).filter(Boolean)
      .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
      .join(" ") || id;
  };

  const localConnectorId = () => cleanConnectorId(state.localConnector?.connectorId || "");

  const effectiveConnectorId = () => localConnectorId();

  const forgetLegacyConnectorPreference = () => {
    try {
      localStorage.removeItem(LEGACY_CONNECTOR_STORAGE_KEY);
    } catch {
      // Old Mac-selection memory is best-effort cleanup only.
    }
  };

  const detectLocalConnector = async () => {
    state.localConnector = null;
    for (const statusUrl of LOCAL_CONNECTOR_STATUS_URLS) {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 3000);
      try {
        const response = await fetch(statusUrl, {
          cache: "no-store",
          credentials: "omit",
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        const connectorId = cleanConnectorId(payload.connectorId);
        if (response.ok && payload.ok && connectorId) {
          state.localConnector = { ...payload, connectorId };
          state.localConnectorChecked = true;
          return;
        }
      } catch {
        state.localConnector = null;
      } finally {
        window.clearTimeout(timer);
      }
    }
    state.localConnectorChecked = true;
  };

  const renderLocalConnector = () => {
    if (!localConnectorRoot) return;
    const connectorId = localConnectorId();
    if (connectorId) {
      const detail = [state.localConnector.hostname, state.localConnector.platform, state.localConnector.version]
        .filter(Boolean)
        .join(" / ");
      localConnectorRoot.innerHTML = `
        <strong>This Mac: ${escapeHtml(connectorDisplayName(connectorId))}</strong>
        ${detail ? `<small>${escapeHtml(detail)}</small>` : ""}
      `;
      localConnectorRoot.dataset.state = "live";
      return;
    }
    localConnectorRoot.innerHTML = state.localConnectorChecked
      ? "<strong>This browser could not verify localhost.</strong><small>If the Mac connector is running, Open Sidecar will try this Mac’s local bridge directly. If that fails, start or reinstall the Mac connector and refresh.</small>"
      : "<strong>Detecting this Mac connector...</strong>";
    localConnectorRoot.dataset.state = state.localConnectorChecked ? "missing" : "busy";
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
    if (result.workspace?.launched) chips.push(chip("Sidecar opened on Mac", "live"));
    if (Number.isFinite(result.recordsPrepared)) chips.push(chip(`${result.recordsPrepared} prepared`, "live"));
    if (Number.isFinite(result.candidateCount)) chips.push(chip(`${result.candidateCount} candidates`));
    if (result.local?.machineNames?.length) chips.push(chip(result.local.machineNames[0], "planned"));
    if (Number.isFinite(result.runCount)) chips.push(chip(`${result.runCount} uploaded`, "live"));
    if (Number.isFinite(result.registration?.registeredCount)) chips.push(chip(`${result.registration.registeredCount} cataloged`, "live"));
    if (Number.isFinite(result.job?.indexedCount)) chips.push(chip(`${result.job.indexedCount} Photos indexed`, "live"));
    if (result.job?.status) chips.push(chip(`Photos ${result.job.status}`, result.job.status === "done" ? "live" : "planned"));
    return chips.join("");
  };

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
    const thisMac = localConnectorId();
    connectorsRoot.innerHTML = state.connectors.map((connector) => {
      const online = isConnectorOnline(connector);
      const isLocal = cleanConnectorId(connector.id) === thisMac;
      return `
        <article class="new-owner-lane-row">
          <div>
            <strong>${escapeHtml(connector.id || "Mac connector")}</strong><br>
            <small>${escapeHtml([connector.hostname, connector.platform, connector.version].filter(Boolean).join(" / "))}</small>
          </div>
          <div class="new-owner-chip-stack">
            ${isLocal ? chip("this Mac", "live") : ""}
            ${chip(online ? "online" : "last seen", online ? "live" : "planned")}
          </div>
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
    actionRoot.innerHTML = `
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
          ${["queued", "claimed"].includes(action.state) ? `<button class="btn secondary" type="button" data-new-owner-action-command="fail" data-action-id="${escapeHtml(action.id)}">Fail</button>` : ""}
        </div>
      </article>
      `).join("")}
    `;
  };

  const setReStatus = (message, stateName = "") => {
    if (!reStatusRoot) return;
    reStatusRoot.textContent = message;
    reStatusRoot.dataset.state = stateName;
  };

  const reAlbumId = (album) => String(album?.localIdentifier || album?.albumLocalIdentifier || "").trim();

  const reAssignment = () => ({
    track: "RE",
    fixture: String(reFixtureInput?.value || "").trim(),
    project: String(reProjectInput?.value || "").trim(),
  });

  const selectedReAlbums = () => state.reAlbums
    .filter((album) => state.reSelectedAlbumIds.has(reAlbumId(album)))
    .map((album) => ({
      albumLocalIdentifier: reAlbumId(album),
      albumName: String(album.title || album.albumName || "Apple Photos album"),
      filterBursts: true,
      allowIcloudDownloads: true,
    }));

  const saveReRouting = () => {
    try {
      localStorage.setItem(RE_FIXTURE_STORAGE_KEY, reFixtureInput?.value || "La Concha");
      localStorage.setItem(RE_PROJECT_STORAGE_KEY, reProjectInput?.value || "Apartment 1");
    } catch {
      // Routing memory is a convenience; the action always carries the current values.
    }
  };

  const validReAssignment = (showError = false) => {
    const assignment = reAssignment();
    const valid = assignment.fixture && assignment.project
      && !/[\\/]/.test(assignment.fixture)
      && !/[\\/]/.test(assignment.project);
    if (!valid && showError) setReStatus("Fixture and sub-fixture are required and must each be one folder name.", "error");
    return valid;
  };

  const syncReControls = () => {
    const hasAlbums = selectedReAlbums().length > 0;
    const preflightButton = $("[data-new-owner-re-preflight]");
    const assignButton = $("[data-new-owner-re-assign]");
    if (preflightButton) preflightButton.disabled = state.busy || !hasAlbums || !validReAssignment();
    if (assignButton) assignButton.disabled = state.busy || !hasAlbums || !validReAssignment();
  };

  const renderRealEstateIntake = () => {
    if (reAlbumsRoot) {
      reAlbumsRoot.innerHTML = state.reAlbums.length
        ? state.reAlbums.map((album) => {
          const id = reAlbumId(album);
          const checked = state.reSelectedAlbumIds.has(id) ? " checked" : "";
          const title = album.title || album.albumName || "Apple Photos album";
          const count = Number(album.assetCount || 0);
          return `
            <label class="new-owner-re-album">
              <input type="checkbox" data-new-owner-re-album-id="${escapeHtml(id)}"${checked}>
              <span><strong>${escapeHtml(title)}</strong><br><small>${count ? `${count.toLocaleString()} item${count === 1 ? "" : "s"}` : escapeHtml(id)}</small></span>
            </label>
          `;
        }).join("")
        : "";
    }
    if (rePreviewRoot) {
      rePreviewRoot.innerHTML = state.rePreviewItems.length
        ? state.rePreviewItems.map((item) => {
          const assetId = String(item.assetId || item.localIdentifier || "");
          const checked = state.reSelectedAssetIds.has(assetId) ? " checked" : "";
          const filename = item.filename || item.originalFilename || "Apple Photos asset";
          const preview = item.previewDataUrl
            ? `<img src="${escapeHtml(item.previewDataUrl)}" alt="${escapeHtml(filename)} preview">`
            : `<span class="new-owner-re-preview-placeholder">${escapeHtml(item.previewError || "Preview unavailable")}</span>`;
          return `
            <article class="new-owner-re-preview-item">
              ${preview}
              <label>
                <input type="checkbox" data-new-owner-re-asset-id="${escapeHtml(assetId)}"${checked}>
                <span><strong>${escapeHtml(filename)}</strong><br><small>${escapeHtml(item.albumName || "")}</small></span>
              </label>
            </article>
          `;
        }).join("")
        : "";
    }
    syncReControls();
  };

  const render = () => {
    renderSession();
    renderCounts();
    renderAccess();
    renderLanes();
    renderConnectors();
    renderLocalConnector();
    renderAction();
    renderRealEstateIntake();
    syncOpenSidecarControl();
    prepareCollapsibleSections();
    queueMasonryLayout();
  };

  const layoutMasonryCards = () => {
    const grid = document.querySelector(".new-owner-grid");
    if (!grid) return;
    const cards = [...grid.querySelectorAll(".new-owner-card")];
    const style = getComputedStyle(grid);
    if (window.matchMedia("(max-width: 900px)").matches || style.gridAutoRows === "auto") {
      cards.forEach((card) => card.style.removeProperty("--new-owner-masonry-span"));
      return;
    }
    const rowHeight = Number.parseFloat(style.getPropertyValue("--new-owner-masonry-row")) || Number.parseFloat(style.gridAutoRows) || 8;
    const rowGap = Number.parseFloat(style.rowGap) || 0;
    cards.forEach((card) => {
      card.style.removeProperty("--new-owner-masonry-span");
      const height = card.getBoundingClientRect().height;
      const span = Math.max(1, Math.ceil((height + rowGap) / (rowHeight + rowGap)));
      card.style.setProperty("--new-owner-masonry-span", String(span));
    });
  };

  let masonryFrame = 0;
  const queueMasonryLayout = () => {
    if (masonryFrame) cancelAnimationFrame(masonryFrame);
    masonryFrame = requestAnimationFrame(() => {
      masonryFrame = 0;
      layoutMasonryCards();
    });
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

      details.className = "new-owner-card-details";
      details.open = !window.matchMedia("(max-width: 900px)").matches || isPrimaryAction;
      details.addEventListener("toggle", queueMasonryLayout);
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

  const readAction = async (actionId) => {
    if (!actionId) return null;
    const body = await apiFetch(`/owner/actions/${encodeURIComponent(actionId)}`);
    return body.action || null;
  };

  const actionStatusLabel = (action, connectorId = effectiveConnectorId()) => {
    const resolvedConnectorId = connectorId || action?.claim?.connectorId || action?.payload?.requestedConnector;
    const connectorName = resolvedConnectorId ? connectorDisplayName(resolvedConnectorId) : "a Mac connector";
    if (!action?.id) return "";
    if (action.state === "completed") return `Completed on ${connectorName}.`;
    if (action.state === "failed") return action.error?.message || `Failed on ${connectorName}.`;
    if (action.state === "claimed") return `${connectorName} is working...`;
    return `Queued — waiting for ${connectorName}.`;
  };

  const monitorAction = async (actionId, connectorId) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 90_000) {
      let action = null;
      try {
        action = await readAction(actionId);
      } catch {
        setActionStatus(
          `Queued — waiting for ${connectorId ? connectorDisplayName(connectorId) : "a Mac connector"}.`,
          "busy",
        );
        await sleep(1_500);
        continue;
      }
      if (action) {
        state.action = action;
        state.actions = mergeActions(state.actions, action);
        setActionStatus(
          actionStatusLabel(action, connectorId),
          terminalActionStates.has(action.state)
            ? (action.state === "failed" ? "error" : "success")
            : "busy",
        );
        render();
        if (terminalActionStates.has(action.state)) return action;
      }
      await sleep(1_500);
    }
    setActionStatus("Still waiting for this Mac connector. Refresh to check again.", "busy");
    return state.action;
  };

  const loadConnectors = async () => {
    const body = await apiFetch("/owner/connectors");
    state.connectors = Array.isArray(body.connectors) ? body.connectors : [];
  };

  const load = async () => {
    if (workerBaseRoot) workerBaseRoot.textContent = workerBase || "same-origin Worker";
    setStatus("Loading cloud Owner state...");
    root?.classList.add("is-loading");
    const localConnectorPromise = detectLocalConnector();
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
      await localConnectorPromise;
      forgetLegacyConnectorPreference();
      setStatus(ownerAllowed() ? "Cloud Owner session verified." : "Owner role is required.");
      if (connectorDownload && ownerAllowed() && workerBase) {
        connectorDownload.href = `${workerBase}/owner/connector/download/mac`;
        connectorDownload.hidden = false;
      }
    } catch (error) {
      state.session = null;
      state.access = null;
      state.actions = [];
      await localConnectorPromise.catch(() => {});
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

  const queueAction = async ({ action, payload, statusLabel = "Queueing...", localConnectorRequired = true, requestedConnectorId = "" }) => {
    if (state.busy) return null;
    const connectorId = cleanConnectorId(requestedConnectorId) || (localConnectorRequired ? effectiveConnectorId() : "");
    if (localConnectorRequired && !connectorId) {
      const message = "This browser cannot identify this Mac connector. Refresh after starting the connector, or use Open Sidecar to try the local bridge directly.";
      setActionStatus(message, "error");
      setStatus("Mac connector not identified by this browser.");
      return null;
    }
    state.busy = true;
    setQueueControlsBusy(true);
    setActionStatus(statusLabel, "busy");
    let completedAction = null;
    let queuedAction = null;
    try {
      const body = await apiFetch("/owner/actions", {
        method: "POST",
        body: JSON.stringify({
          action,
          payload: {
            ...payload,
            ...(connectorId ? { requestedConnector: connectorId } : {}),
          },
        }),
      });
      state.action = body.action || null;
      queuedAction = state.action;
      await loadActions();
      setActionStatus(
        state.action?.id && connectorId
          ? actionStatusLabel(state.action, connectorId)
          : "",
        "success",
      );
      setStatus("Owner action queued.");
      render();
      if (state.action?.id) {
        completedAction = await monitorAction(state.action.id, connectorId);
      }
    } catch (error) {
      const message = queueErrorMessage(error);
      setActionStatus(message, "error");
      setStatus(message);
    } finally {
      state.busy = false;
      setQueueControlsBusy(false);
      renderRealEstateIntake();
    }
    return completedAction || queuedAction;
  };

  const queueCheck = () => queueAction({
    action: "owner-connector-check",
    payload: {
      surface: "owner",
      checkedAt: new Date().toISOString(),
    },
    statusLabel: "Queueing...",
  });

  const openLocalSidecar = async () => {
    if (state.busy) return;
    state.busy = true;
    setQueueControlsBusy(true);
    let navigating = false;
    try {
      setActionStatus("Checking this Mac’s local bridge...", "busy");
      setStatus("Checking this Mac connector...");
      if (!localConnectorId()) {
        await detectLocalConnector();
        render();
      }
      if (!localConnectorId()) {
        setActionStatus("This browser could not verify localhost; trying this Mac’s local bridge directly...", "busy");
        setStatus("Trying this Mac’s local bridge directly...");
      }
      setActionStatus("Opening this Mac’s local bridge...", "busy");
      setStatus("Opening Sidecar on this Mac...");
      const url = new URL(LOCAL_SIDECAR_OPEN_URL);
      url.searchParams.set("source", "new-owner");
      url.searchParams.set("returnTo", window.location.href);
      url.searchParams.set("t", String(Date.now()));
      navigating = true;
      window.location.href = url.href;
    } finally {
      if (!navigating) {
        state.busy = false;
        setQueueControlsBusy(false);
        syncOpenSidecarControl();
      }
    }
  };

  const queuePhotosIndexSync = () => queueAction({
    action: "sidecar-photos-index-sync",
    payload: {
      queuedAt: new Date().toISOString(),
    },
    statusLabel: "Queueing Photos refresh...",
  });

  const queueUploadPublish = () => queueAction({
    action: "sidecar-upload-publish",
    payload: {
      limit: 1,
      queuedAt: new Date().toISOString(),
    },
    statusLabel: "Queueing upload...",
  });

  const reActionManifest = (mode, extra = {}) => ({
    mode,
    workflow: "apple-photos-real-estate-intake",
    source: "apple-photos",
    destinationKind: "real_estate",
    intakeAssignment: reAssignment(),
    filterBursts: true,
    allowIcloudDownloads: true,
    ...extra,
  });

  const loadReAlbums = async () => {
    if (!validReAssignment(true)) return;
    saveReRouting();
    setReStatus("Loading Apple Photos albums from this Mac…", "busy");
    const completed = await queueAction({
      action: "sidecar-culling-review",
      payload: {
        workflow: "apple-photos-real-estate-intake",
        manifest: reActionManifest("apple-photos-re-albums", { includePreviews: false }),
        queuedAt: new Date().toISOString(),
      },
      statusLabel: "Loading Apple Photos albums…",
    });
    if (completed?.state !== "completed") {
      setReStatus(completed?.error?.message || "Apple Photos albums were not loaded.", "error");
      return;
    }
    state.reAlbums = Array.isArray(completed.result?.albums) ? completed.result.albums : [];
    state.reSelectedAlbumIds = new Set(
      [...state.reSelectedAlbumIds].filter((id) => state.reAlbums.some((album) => reAlbumId(album) === id)),
    );
    state.rePreviewItems = [];
    state.reSelectedAssetIds = new Set();
    setReStatus(completed.result?.message || `Loaded ${state.reAlbums.length.toLocaleString()} album(s). Select one or more.`, "success");
    renderRealEstateIntake();
    queueMasonryLayout();
  };

  const previewReAlbums = async () => {
    const albums = selectedReAlbums();
    if (!albums.length || !validReAssignment(true)) return;
    saveReRouting();
    setReStatus(`Preparing private previews for ${albums.length} selected album${albums.length === 1 ? "" : "s"}…`, "busy");
    const completed = await queueAction({
      action: "sidecar-culling-review",
      payload: {
        workflow: "apple-photos-real-estate-intake",
        manifest: reActionManifest("apple-photos-re-preflight", {
          albums,
          includePreviews: true,
          limit: 100,
        }),
        queuedAt: new Date().toISOString(),
      },
      statusLabel: "Preparing private Apple Photos previews…",
    });
    if (completed?.state !== "completed") {
      setReStatus(completed?.error?.message || "The selected albums could not be previewed.", "error");
      return;
    }
    state.rePreviewItems = Array.isArray(completed.result?.previewItems) ? completed.result.previewItems : [];
    state.reSelectedAssetIds = new Set(
      state.rePreviewItems.map((item) => String(item.assetId || item.localIdentifier || "")).filter(Boolean),
    );
    setReStatus(
      completed.result?.message || `Prepared ${state.rePreviewItems.length.toLocaleString()} private candidate(s).`,
      "success",
    );
    renderRealEstateIntake();
    queueMasonryLayout();
  };

  const assignRePhotos = async () => {
    const albums = selectedReAlbums();
    if (!albums.length || !validReAssignment(true)) return;
    const selectedAssetIds = state.rePreviewItems.length ? [...state.reSelectedAssetIds] : [];
    if (state.rePreviewItems.length && !selectedAssetIds.length) {
      setReStatus("Select at least one previewed photo, or reload the albums to assign complete albums.", "error");
      return;
    }
    const assignment = reAssignment();
    const countLabel = selectedAssetIds.length
      ? `${selectedAssetIds.length} selected photo${selectedAssetIds.length === 1 ? "" : "s"}`
      : `${albums.length} complete album${albums.length === 1 ? "" : "s"}`;
    if (!window.confirm(`Assign ${countLabel} to ${assignment.track} / ${assignment.fixture} / ${assignment.project}?\n\nThis stays local. Nothing will be published, uploaded, exposed, or messaged.`)) return;
    saveReRouting();
    setReStatus(`Assigning ${countLabel} to the persistent local RE intake…`, "busy");
    const completed = await queueAction({
      action: "sidecar-culling-review",
      payload: {
        workflow: "apple-photos-real-estate-intake",
        manifest: reActionManifest("apple-photos-re-assign", {
          albums,
          selectedAssetIds,
          includePreviews: false,
        }),
        queuedAt: new Date().toISOString(),
      },
      statusLabel: "Assigning Apple Photos to local RE intake…",
    });
    if (completed?.state !== "completed") {
      setReStatus(completed?.error?.message || "The Apple Photos assignment failed.", "error");
      return;
    }
    const result = completed.result || {};
    setReStatus(
      result.message || `Assigned privately to ${assignment.track} / ${assignment.fixture} / ${assignment.project}. Nothing was published.`,
      "success",
    );
    state.rePreviewItems = [];
    state.reSelectedAssetIds = new Set();
    renderRealEstateIntake();
    queueMasonryLayout();
  };

  const transitionAction = async (actionId, command) => {
    if (state.busy || !actionId || !command) return;
    state.busy = true;
    if (actionStatusRoot) actionStatusRoot.textContent = `${command[0].toUpperCase()}${command.slice(1)}...`;
    try {
      const connectorId = effectiveConnectorId();
      const payload = command === "claim"
        ? { connectorId }
        : command === "complete"
          ? { result: { connectorId, surface: "new-owner", completedAt: new Date().toISOString() } }
          : { message: "Marked failed from NewOwner." };
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

  try {
    if (reFixtureInput) reFixtureInput.value = localStorage.getItem(RE_FIXTURE_STORAGE_KEY) || reFixtureInput.value;
    if (reProjectInput) reProjectInput.value = localStorage.getItem(RE_PROJECT_STORAGE_KEY) || reProjectInput.value;
  } catch {
    // Keep the HTML defaults when local storage is unavailable.
  }

  $("[data-new-owner-refresh]")?.addEventListener("click", () => load());
  $("[data-new-owner-login]")?.addEventListener("click", login);
  $("[data-new-owner-logout]")?.addEventListener("click", logout);
  $("[data-new-owner-queue-check]")?.addEventListener("click", queueCheck);
  $("[data-new-owner-sync-photos]")?.addEventListener("click", queuePhotosIndexSync);
  $("[data-new-owner-queue-sidecar]")?.addEventListener("click", openLocalSidecar);
  $("[data-new-owner-upload-publish]")?.addEventListener("click", queueUploadPublish);
  $("[data-new-owner-re-load]")?.addEventListener("click", loadReAlbums);
  $("[data-new-owner-re-preflight]")?.addEventListener("click", previewReAlbums);
  $("[data-new-owner-re-assign]")?.addEventListener("click", assignRePhotos);
  [reFixtureInput, reProjectInput].filter(Boolean).forEach((input) => {
    input.addEventListener("input", () => {
      saveReRouting();
      syncReControls();
    });
  });
  reAlbumsRoot?.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-new-owner-re-album-id]");
    if (!checkbox) return;
    const id = checkbox.getAttribute("data-new-owner-re-album-id") || "";
    if (checkbox.checked) state.reSelectedAlbumIds.add(id);
    else state.reSelectedAlbumIds.delete(id);
    state.rePreviewItems = [];
    state.reSelectedAssetIds = new Set();
    setReStatus(`${state.reSelectedAlbumIds.size} album${state.reSelectedAlbumIds.size === 1 ? "" : "s"} selected.`, "success");
    renderRealEstateIntake();
    queueMasonryLayout();
  });
  rePreviewRoot?.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-new-owner-re-asset-id]");
    if (!checkbox) return;
    const id = checkbox.getAttribute("data-new-owner-re-asset-id") || "";
    if (checkbox.checked) state.reSelectedAssetIds.add(id);
    else state.reSelectedAssetIds.delete(id);
    setReStatus(`${state.reSelectedAssetIds.size} photo${state.reSelectedAssetIds.size === 1 ? "" : "s"} selected for private assignment.`, "success");
    syncReControls();
  });
  actionRoot?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-new-owner-action-command]");
    if (!button) return;
    const command = button.getAttribute("data-new-owner-action-command");
    const actionId = button.getAttribute("data-action-id");
    transitionAction(actionId, command);
  });
  window.addEventListener("resize", queueMasonryLayout);
  absorbAuthTokenFromHash();
  forgetLegacyConnectorPreference();
  renderLanes();
  load();
})();
