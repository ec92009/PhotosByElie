(() => {
  const cleanBase = (value) => String(value || "").trim().replace(/\/+$/, "");
  const mediaConfig = window.photosByElieMediaConfig || {};
  const workerBase = cleanBase(mediaConfig.authWorkerBaseUrl || mediaConfig.checkoutWorkerBaseUrl || "");
  const state = {
    people: [],
    fixtureEvents: [],
    audienceGroups: [],
    galleryOptions: [],
    capabilities: [],
    auditEvents: [],
    roles: [],
    selectedEmail: "",
    session: null,
  };

  const $ = (selector) => document.querySelector(selector);
  const root = $("[data-acs-root]");
  const statusRoot = $("[data-acs-status]");
  const sessionRoot = $("[data-acs-session]");
  const peopleRoot = $("[data-acs-people]");
  const eventsRoot = $("[data-acs-events]");
  const auditRoot = $("[data-acs-audit]");
  const groupsRoot = $("[data-acs-groups]");
  const galleryOptionsRoot = $("[data-acs-gallery-options]");
  const effectiveAccessRoot = $("[data-acs-effective-access]");
  const capabilitiesRoot = $("[data-acs-capabilities]");
  const workerBaseRoot = $("[data-acs-worker-base]");
  const themeToggle = $("[data-theme-toggle]");
  const form = $("[data-acs-person-form]");
  const emailInput = $("[data-acs-email]");
  const displayNameInput = $("[data-acs-display-name]");
  const realEstateInput = $("[data-acs-real-estate]");
  const notesInput = $("[data-acs-notes]");
  const editorTitle = $("[data-acs-editor-title]");

  const setStatus = (message) => {
    if (statusRoot) statusRoot.textContent = message;
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

  const escapeHtml = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const apiUrl = (path) => {
    if (!workerBase) return path;
    return `${workerBase}${path}`;
  };

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
      throw new Error(body?.error?.message || body?.error || `ACS request failed with HTTP ${response.status}.`);
    }
    return body;
  };

  const parseLines = (value) => [...new Set(String(value || "")
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean))];

  const roleClass = (role) => role === "owner" ? " is-owner" : "";

  const capabilityLabel = (capabilityId) =>
    state.capabilities.find((capability) => capability.id === capabilityId)?.label || capabilityId;

  const groupLabel = (groupId) =>
    state.audienceGroups.find((group) => group.id === groupId)?.label || groupId;

  const formatCapabilityChips = (capabilities = []) => {
    const list = Array.isArray(capabilities) ? capabilities : [];
    if (!list.length) return `<span class="acs-person-meta">none</span>`;
    return `<span class="acs-gallery-stack">${list.map((capability) => `<span class="acs-chip">${escapeHtml(capabilityLabel(capability))}</span>`).join("")}</span>`;
  };

  const formatRoles = (user) => {
    const roles = Array.isArray(user?.roles) && user.roles.length ? user.roles : ["user"];
    return `<span class="acs-role-stack">${roles.map((role) => `<span class="acs-chip${roleClass(role)}">${escapeHtml(role)}</span>`).join("")}</span>`;
  };

  const formatGalleries = (user) => {
    const scopes = Array.isArray(user?.effectiveAccess?.scopes) ? user.effectiveAccess.scopes : [];
    const galleries = scopes
      .filter((scope) => scope.galleryKind && !["public", "owner"].includes(scope.galleryKind))
      .map((scope) => scope.label || scope.galleryKey)
      .filter(Boolean);
    if (!galleries.length) return `<span class="acs-person-meta">public only</span>`;
    return `<span class="acs-gallery-stack">${galleries.map((key) => `<span class="acs-chip">${escapeHtml(key)}</span>`).join("")}</span>`;
  };

  const renderChoiceList = (rootNode, items, inputName, dataName, emptyText) => {
    if (!rootNode) return;
    if (!items.length) {
      rootNode.innerHTML = `<p class="acs-empty">${escapeHtml(emptyText)}</p>`;
      return;
    }
    rootNode.innerHTML = items.map((item) => {
      const id = `${inputName}-${item.id || item.galleryKey}`.replace(/[^a-z0-9_-]+/gi, "-");
      const value = item.id || item.galleryKey;
      const meta = [
        item.kind || item.galleryKind,
        item.galleryKey && item.galleryKey !== item.id ? item.galleryKey : "",
      ].filter(Boolean).join(" / ");
      return `
        <label for="${escapeHtml(id)}">
          <input id="${escapeHtml(id)}" type="checkbox" ${dataName}="${escapeHtml(value)}"/>
          <span>
            <strong>${escapeHtml(item.label || value)}</strong>
            ${meta ? `<small>${escapeHtml(meta)}</small>` : ""}
          </span>
        </label>
      `;
    }).join("");
  };

  const renderPickers = () => {
    renderChoiceList(groupsRoot, state.audienceGroups, "acs-group", "data-acs-group", "Seed fixtures to load audience groups.");
    renderChoiceList(
      galleryOptionsRoot,
      state.galleryOptions.filter((option) => option.galleryKind === "real_estate"),
      "acs-gallery",
      "data-acs-gallery",
      "Seed fixtures to load RE gallery options."
    );
  };

  const checkedValues = (selector, datasetKey) => [...document.querySelectorAll(selector)]
    .filter((input) => input.checked)
    .map((input) => input.dataset[datasetKey])
    .filter(Boolean);

  const personState = (user) => {
    if (user?.disabledAt) return `<span class="acs-chip is-disabled">disabled</span>`;
    if (user?.fixture) return `<span class="acs-chip is-fixture">fixture</span>`;
    return `<span class="acs-chip">active</span>`;
  };

  const selectedUser = () => state.people.find((user) => user.email === state.selectedEmail) || null;

  const hasRealEstateAccess = (user) => Boolean(
    (user?.roles || []).includes("re_client")
    || user?.realEstateClients?.length
    || (user?.effectiveAccess?.scopes || []).some((scope) => scope.galleryKind === "real_estate")
  );

  const fillForm = (user = null) => {
    const item = user || {};
    if (emailInput) emailInput.value = item.email || "";
    if (displayNameInput) displayNameInput.value = item.displayName || "";
    if (realEstateInput) {
      const checkboxKeys = new Set(state.galleryOptions
        .filter((option) => option.galleryKind === "real_estate")
        .map((option) => option.galleryKey));
      realEstateInput.value = (item.realEstateClients || [])
        .filter((galleryKey) => !checkboxKeys.has(galleryKey))
        .join("\n");
    }
    if (notesInput) notesInput.value = item.notes || "";
    document.querySelectorAll("[data-acs-role]").forEach((input) => {
      const role = input.dataset.acsRole;
      input.checked = role === "user" || (item.roles || []).includes(role);
    });
    const groupIds = new Set(item.groupIds || []);
    document.querySelectorAll("[data-acs-group]").forEach((input) => {
      input.checked = groupIds.has(input.dataset.acsGroup);
    });
    const directGalleries = new Set(item.realEstateClients || []);
    document.querySelectorAll("[data-acs-gallery]").forEach((input) => {
      input.checked = directGalleries.has(input.dataset.acsGallery);
    });
    if (editorTitle) editorTitle.textContent = item.email ? item.email : "New person";
  };

  const renderSession = () => {
    const session = state.session;
    if (!sessionRoot) return;
    if (!session?.authenticated) {
      sessionRoot.innerHTML = `<strong>Signed out</strong><br><small>Use Google sign-in to open ACS.</small>`;
      return;
    }
    const roles = (session.roles || []).join(", ");
    sessionRoot.innerHTML = `
      <strong>${escapeHtml(session.user?.email || "")}</strong><br>
      <small>${escapeHtml(roles || "user")}${session.admin ? " / bootstrap admin" : ""}</small>
    `;
  };

  const renderCounts = () => {
    const people = state.people;
    const setCount = (key, value) => {
      const node = $(`[data-acs-count="${key}"]`);
      if (node) node.textContent = String(value);
    };
    setCount("people", people.length);
    setCount("owners", people.filter((user) => (user.roles || []).includes("owner") && !user.disabledAt).length);
    setCount("re", people.filter((user) => hasRealEstateAccess(user) && !user.disabledAt).length);
    setCount("groups", state.audienceGroups.length);
    setCount("fixtures", people.filter((user) => user.fixture).length);
    setCount("disabled", people.filter((user) => user.disabledAt).length);
  };

  const renderPeople = () => {
    if (!peopleRoot) return;
    if (!state.people.length) {
      peopleRoot.innerHTML = `<tr><td colspan="4" class="acs-empty">No people are stored yet. Seed fixtures or add a person.</td></tr>`;
      return;
    }
    peopleRoot.innerHTML = state.people.map((user) => {
      const active = user.email === state.selectedEmail;
      return `
        <tr class="${active ? "is-active" : ""}" data-acs-person="${escapeHtml(user.email)}">
          <td>
            <strong>${escapeHtml(user.email)}</strong>
            ${user.displayName ? `<br><span class="acs-person-meta">${escapeHtml(user.displayName)}</span>` : ""}
          </td>
          <td>${formatRoles(user)}</td>
          <td>${formatGalleries(user)}</td>
          <td>${personState(user)}</td>
        </tr>
      `;
    }).join("");
  };

  const renderEvents = () => {
    if (!eventsRoot) return;
    if (!state.fixtureEvents.length) {
      eventsRoot.innerHTML = `<p class="acs-empty">No fixture events are seeded yet.</p>`;
      return;
    }
    eventsRoot.innerHTML = state.fixtureEvents.map((event) => `
      <article class="acs-event">
        <strong>${escapeHtml(event.label || event.id)}</strong>
        <span class="acs-chip is-fixture">${escapeHtml(event.kind || "fixture")}</span>
        <span class="acs-event-policy">${escapeHtml(event.accessPolicy || event.access_policy || "")}</span>
      </article>
    `).join("");
  };

  const renderEffectiveAccess = () => {
    if (!effectiveAccessRoot) return;
    const user = selectedUser();
    if (!user) {
      effectiveAccessRoot.innerHTML = `<p class="acs-empty">Select or save a person to inspect effective access.</p>`;
      return;
    }
    const groups = Array.isArray(user.groups) ? user.groups : [];
    const scopes = Array.isArray(user.effectiveAccess?.scopes) ? user.effectiveAccess.scopes : [];
    effectiveAccessRoot.innerHTML = `
      <p class="acs-effective-summary">${escapeHtml(user.effectiveAccess?.summary || "Public galleries and account recovery")}</p>
      <div class="acs-effective-section">
        <strong>Groups</strong>
        ${groups.length
          ? `<span class="acs-gallery-stack">${groups.map((group) => `<span class="acs-chip">${escapeHtml(group.label || groupLabel(group.id))}</span>`).join("")}</span>`
          : `<span class="acs-person-meta">none</span>`}
      </div>
      <div class="acs-scope-list">
        ${scopes.map((scope) => `
          <article class="acs-scope">
            <strong>${escapeHtml(scope.label || scope.galleryKey || scope.role || "Access")}</strong>
            <small>${escapeHtml([scope.source, scope.galleryKind, scope.galleryKey].filter(Boolean).join(" / "))}</small>
            ${scope.accessPolicy ? `<p>${escapeHtml(scope.accessPolicy)}</p>` : ""}
            ${formatCapabilityChips(scope.capabilities)}
          </article>
        `).join("")}
      </div>
    `;
  };

  const renderCapabilities = () => {
    if (!capabilitiesRoot) return;
    const roleRows = state.roles.map((role) => ({
      label: role.label || role.id,
      kind: "role",
      capabilities: role.capabilities || [],
    }));
    const groupRows = state.audienceGroups.map((group) => ({
      label: group.label || group.id,
      kind: group.kind || "group",
      capabilities: group.capabilities || [],
    }));
    const rows = [...roleRows, ...groupRows];
    if (!rows.length) {
      capabilitiesRoot.innerHTML = `<p class="acs-empty">Seed fixtures to load group capabilities.</p>`;
      return;
    }
    capabilitiesRoot.innerHTML = rows.map((row) => `
      <article class="acs-capability-row">
        <div>
          <strong>${escapeHtml(row.label)}</strong>
          <small>${escapeHtml(row.kind)}</small>
        </div>
        ${formatCapabilityChips(row.capabilities)}
      </article>
    `).join("");
  };

  const renderAudit = () => {
    if (!auditRoot) return;
    if (!state.auditEvents.length) {
      auditRoot.innerHTML = `<li class="acs-empty">No audit events yet.</li>`;
      return;
    }
    auditRoot.innerHTML = state.auditEvents.map((event) => `
      <li>
        <strong>${escapeHtml(event.eventType || "change")}</strong>
        ${event.targetEmail ? `for <code>${escapeHtml(event.targetEmail)}</code>` : ""}
        ${event.actorEmail ? `by <code>${escapeHtml(event.actorEmail)}</code>` : ""}
        <br><time>${escapeHtml(event.createdAt || "")}</time>
      </li>
    `).join("");
  };

  const render = () => {
    renderSession();
    renderCounts();
    renderPickers();
    renderPeople();
    renderEvents();
    renderCapabilities();
    renderAudit();
    fillForm(selectedUser());
    renderEffectiveAccess();
  };

  const load = async () => {
    if (workerBaseRoot) workerBaseRoot.textContent = workerBase || "same-origin Worker";
    setStatus("Loading ACS state...");
    root?.classList.add("is-loading");
    try {
      const body = await apiFetch("/access-console/state");
      state.session = body.session;
      state.roles = Array.isArray(body.roles) ? body.roles : [];
      state.capabilities = Array.isArray(body.capabilities) ? body.capabilities : [];
      state.people = Array.isArray(body.people) ? body.people : [];
      state.fixtureEvents = Array.isArray(body.fixtureEvents) ? body.fixtureEvents : [];
      state.audienceGroups = Array.isArray(body.audienceGroups) ? body.audienceGroups : [];
      state.galleryOptions = Array.isArray(body.galleryOptions) ? body.galleryOptions : [];
      state.auditEvents = Array.isArray(body.auditEvents) ? body.auditEvents : [];
      if (!state.selectedEmail || !state.people.some((user) => user.email === state.selectedEmail)) {
        state.selectedEmail = state.people[0]?.email || "";
      }
      setStatus(`${state.people.length} people loaded from cloud access state.`);
      render();
    } catch (error) {
      setStatus(error.message || "ACS is unavailable.");
      state.session = null;
      state.people = [];
      state.fixtureEvents = [];
      state.audienceGroups = [];
      state.galleryOptions = [];
      state.capabilities = [];
      state.auditEvents = [];
      render();
    } finally {
      root?.classList.remove("is-loading");
    }
  };

  const savePerson = async () => {
    const roles = ["user"];
    document.querySelectorAll("[data-acs-role]").forEach((input) => {
      if (!input.disabled && input.checked) roles.push(input.dataset.acsRole);
    });
    const payload = {
      email: emailInput?.value || "",
      displayName: displayNameInput?.value || "",
      roles,
      realEstateClients: [...new Set([
        ...checkedValues("[data-acs-gallery]", "acsGallery"),
        ...parseLines(realEstateInput?.value || ""),
      ])],
      groupIds: checkedValues("[data-acs-group]", "acsGroup"),
      notes: notesInput?.value || "",
      fixture: selectedUser()?.fixture === true,
    };
    setStatus(`Saving ${payload.email || "person"}...`);
    const body = await apiFetch("/access-console/people", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    state.selectedEmail = body.user?.email || payload.email;
    await load();
  };

  const disableSelected = async () => {
    const user = selectedUser();
    if (!user?.email) {
      setStatus("Select a person before disabling.");
      return;
    }
    if (!window.confirm?.(`Disable ${user.email}? This revokes active roles and grants but keeps audit history.`)) return;
    setStatus(`Disabling ${user.email}...`);
    await apiFetch(`/access-console/people/${encodeURIComponent(user.email)}/disable`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    await load();
  };

  const seedFixtures = async () => {
    setStatus("Seeding fixture people and events...");
    await apiFetch("/access-console/fixtures/seed", {
      method: "POST",
      body: JSON.stringify({}),
    });
    await load();
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

  peopleRoot?.addEventListener("click", (event) => {
    const row = event.target.closest("[data-acs-person]");
    if (!row) return;
    state.selectedEmail = row.dataset.acsPerson || "";
    render();
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await savePerson();
    } catch (error) {
      setStatus(error.message || "Could not save person.");
    }
  });

  $("[data-acs-refresh]")?.addEventListener("click", () => load());
  $("[data-acs-new-person]")?.addEventListener("click", () => {
    state.selectedEmail = "";
    fillForm(null);
    renderPeople();
    renderEffectiveAccess();
  });
  $("[data-acs-disable-person]")?.addEventListener("click", () => disableSelected().catch((error) => setStatus(error.message || "Could not disable person.")));
  $("[data-acs-seed-fixtures]")?.addEventListener("click", () => seedFixtures().catch((error) => setStatus(error.message || "Could not seed fixtures.")));
  $("[data-acs-login]")?.addEventListener("click", login);
  $("[data-acs-logout]")?.addEventListener("click", logout);
  themeToggle?.addEventListener("click", toggleTheme);

  syncThemeToggle();
  load();
})();
