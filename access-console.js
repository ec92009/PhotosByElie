(() => {
  const cleanBase = (value) => String(value || "").trim().replace(/\/+$/, "");
  const mediaConfig = window.photosByElieMediaConfig || {};
  const workerBase = cleanBase(mediaConfig.authWorkerBaseUrl || mediaConfig.checkoutWorkerBaseUrl || "");
  const state = {
    people: [],
    fixtureEvents: [],
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

  const formatRoles = (user) => {
    const roles = Array.isArray(user?.roles) && user.roles.length ? user.roles : ["user"];
    return `<span class="acs-role-stack">${roles.map((role) => `<span class="acs-chip${roleClass(role)}">${escapeHtml(role)}</span>`).join("")}</span>`;
  };

  const formatGalleries = (user) => {
    const galleries = Array.isArray(user?.realEstateClients) ? user.realEstateClients : [];
    if (!galleries.length) return `<span class="acs-person-meta">none</span>`;
    return `<span class="acs-gallery-stack">${galleries.map((key) => `<span class="acs-chip">${escapeHtml(key)}</span>`).join("")}</span>`;
  };

  const personState = (user) => {
    if (user?.disabledAt) return `<span class="acs-chip is-disabled">disabled</span>`;
    if (user?.fixture) return `<span class="acs-chip is-fixture">fixture</span>`;
    return `<span class="acs-chip">active</span>`;
  };

  const selectedUser = () => state.people.find((user) => user.email === state.selectedEmail) || null;

  const fillForm = (user = null) => {
    const item = user || {};
    if (emailInput) emailInput.value = item.email || "";
    if (displayNameInput) displayNameInput.value = item.displayName || "";
    if (realEstateInput) realEstateInput.value = (item.realEstateClients || []).join("\n");
    if (notesInput) notesInput.value = item.notes || "";
    document.querySelectorAll("[data-acs-role]").forEach((input) => {
      const role = input.dataset.acsRole;
      input.checked = role === "user" || (item.roles || []).includes(role);
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
    setCount("re", people.filter((user) => ((user.roles || []).includes("re_client") || user.realEstateClients?.length) && !user.disabledAt).length);
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
    renderPeople();
    renderEvents();
    renderAudit();
    fillForm(selectedUser());
  };

  const load = async () => {
    if (workerBaseRoot) workerBaseRoot.textContent = workerBase || "same-origin Worker";
    setStatus("Loading ACS state...");
    root?.classList.add("is-loading");
    try {
      const body = await apiFetch("/access-console/state");
      state.session = body.session;
      state.roles = Array.isArray(body.roles) ? body.roles : [];
      state.people = Array.isArray(body.people) ? body.people : [];
      state.fixtureEvents = Array.isArray(body.fixtureEvents) ? body.fixtureEvents : [];
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
      realEstateClients: parseLines(realEstateInput?.value || ""),
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
  });
  $("[data-acs-disable-person]")?.addEventListener("click", () => disableSelected().catch((error) => setStatus(error.message || "Could not disable person.")));
  $("[data-acs-seed-fixtures]")?.addEventListener("click", () => seedFixtures().catch((error) => setStatus(error.message || "Could not seed fixtures.")));
  $("[data-acs-login]")?.addEventListener("click", login);
  $("[data-acs-logout]")?.addEventListener("click", logout);
  themeToggle?.addEventListener("click", toggleTheme);

  syncThemeToggle();
  load();
})();
