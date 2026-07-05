(() => {
  const cleanBase = (value) => String(value || "").trim().replace(/\/+$/, "");
  const mediaConfig = window.photosByElieMediaConfig || {};
  const workerBase = cleanBase(mediaConfig.authWorkerBaseUrl || mediaConfig.checkoutWorkerBaseUrl || "");
  const state = {
    session: null,
    access: null,
    action: null,
    actions: [],
    busy: false,
  };
  const lanes = [
    { label: "Identity and roles", state: "live", detail: "Google session, D1 access registry, ACS policy tester" },
    { label: "Owner action queue", state: "live", detail: "Worker-authenticated queue records in cloud KV" },
    { label: "Real Estate outputs", state: "mixed", detail: "Cloud PDF/video storage with local source import still pending" },
    { label: "Apple Photos import", state: "local", detail: "Requires a local connector on Max, David, or Curie" },
    { label: "Sidecar culling", state: "local", detail: "Candidate for the first connector-backed Track B workflow" },
  ];

  const $ = (selector) => document.querySelector(selector);
  const root = $("[data-new-owner-root]");
  const statusRoot = $("[data-new-owner-status]");
  const sessionRoot = $("[data-new-owner-session]");
  const accessRoot = $("[data-new-owner-access]");
  const lanesRoot = $("[data-new-owner-lanes]");
  const actionRoot = $("[data-new-owner-action]");
  const actionStatusRoot = $("[data-new-owner-action-status]");
  const workerBaseRoot = $("[data-new-owner-worker-base]");
  const themeToggle = $("[data-theme-toggle]");

  const setStatus = (message) => {
    if (statusRoot) statusRoot.textContent = message;
  };

  const escapeHtml = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const apiUrl = (path) => workerBase ? `${workerBase}${path}` : path;

  const apiFetch = async (path, options = {}) => {
    const response = await fetch(apiUrl(path), {
      credentials: "include",
      cache: "no-store",
      ...options,
      headers: {
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

  const syncThemeToggle = () => {
    if (!themeToggle) return;
    const isDark = document.documentElement.dataset.theme === "dark";
    themeToggle.setAttribute("aria-pressed", String(isDark));
    themeToggle.setAttribute("title", isDark ? "Switch to day mode" : "Switch to night mode");
  };

  const toggleTheme = () => {
    const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("byelie-theme", next);
    } catch {
      // Theme persistence is best-effort only.
    }
    syncThemeToggle();
  };

  const ownerAllowed = () => {
    const roles = Array.isArray(state.session?.roles) ? state.session.roles : [];
    return state.session?.admin === true || state.session?.tier === "owner" || roles.includes("owner") || roles.includes("admin");
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
  };

  const chip = (label, modifier = "") =>
    `<span class="new-owner-chip ${modifier ? `is-${escapeHtml(modifier)}` : ""}">${escapeHtml(label)}</span>`;

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

  const renderAction = () => {
    if (!actionRoot) return;
    const actions = state.actions.length ? state.actions : (state.action?.id ? [state.action] : []);
    if (!actions.length) {
      actionRoot.innerHTML = `<p class="new-owner-empty">No recent cloud Owner actions.</p>`;
      return;
    }
    actionRoot.innerHTML = actions.map((action) => `
      <article class="new-owner-action-row">
        <strong>${escapeHtml(action.type || "owner action")}</strong>
        <small>${escapeHtml(action.id)}</small>
        <div class="new-owner-chip-stack">
          ${chip(action.state || "queued", action.state === "failed" ? "local" : "live")}
          ${action.createdAt ? chip(action.createdAt) : ""}
        </div>
      </article>
    `).join("");
  };

  const render = () => {
    renderSession();
    renderCounts();
    renderAccess();
    renderLanes();
    renderAction();
  };

  const loadActions = async () => {
    const body = await apiFetch("/owner/actions?limit=8");
    state.actions = mergeActions(Array.isArray(body.actions) ? body.actions : []);
    state.action = state.actions[0] || state.action;
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
      }
      setStatus(ownerAllowed() ? "Cloud Owner session verified." : "Owner role is required.");
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
    const url = new URL(`${workerBase}/auth/google/login`);
    url.searchParams.set("returnTo", window.location.href);
    window.location.href = url.href;
  };

  const logout = () => {
    if (!workerBase) return;
    const url = new URL(`${workerBase}/auth/logout`);
    url.searchParams.set("returnTo", window.location.href);
    window.location.href = url.href;
  };

  const queueCheck = async () => {
    if (state.busy) return;
    state.busy = true;
    if (actionStatusRoot) actionStatusRoot.textContent = "Queueing...";
    try {
      const body = await apiFetch("/owner/actions", {
        method: "POST",
        body: JSON.stringify({
          action: "track-b-cloud-shell-check",
          payload: {
            surface: "new-owner",
            localFilesRequired: false,
            checkedAt: new Date().toISOString(),
          },
        }),
      });
      state.action = body.action || null;
      if (state.action?.id) {
        const readback = await apiFetch(`/owner/actions/${encodeURIComponent(state.action.id)}`);
        state.action = readback.action || state.action;
      }
      await loadActions();
      if (actionStatusRoot) actionStatusRoot.textContent = state.action?.id ? "Queued" : "";
      setStatus("Owner action queue check complete.");
      render();
    } catch (error) {
      if (actionStatusRoot) actionStatusRoot.textContent = "";
      setStatus(error.message || "Could not queue Owner action.");
    } finally {
      state.busy = false;
    }
  };

  $("[data-new-owner-refresh]")?.addEventListener("click", () => load());
  $("[data-new-owner-login]")?.addEventListener("click", login);
  $("[data-new-owner-logout]")?.addEventListener("click", logout);
  $("[data-new-owner-queue-check]")?.addEventListener("click", queueCheck);
  themeToggle?.addEventListener("click", toggleTheme);

  syncThemeToggle();
  renderLanes();
  load();
})();
