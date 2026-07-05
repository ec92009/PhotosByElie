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
    selectedGroupId: "",
    filters: {
      search: "",
      groupId: "",
      role: "",
      state: "",
    },
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
  const groupListRoot = $("[data-acs-group-list]");
  const memberListRoot = $("[data-acs-member-list]");
  const galleryOptionsRoot = $("[data-acs-gallery-options]");
  const effectiveAccessRoot = $("[data-acs-effective-access]");
  const capabilitiesRoot = $("[data-acs-capabilities]");
  const groupCapabilitiesRoot = $("[data-acs-group-capabilities]");
  const filterSummaryRoot = $("[data-acs-filter-summary]");
  const workerBaseRoot = $("[data-acs-worker-base]");
  const themeToggle = $("[data-theme-toggle]");
  const form = $("[data-acs-person-form]");
  const groupForm = $("[data-acs-group-form]");
  const memberForm = $("[data-acs-member-form]");
  const emailInput = $("[data-acs-email]");
  const displayNameInput = $("[data-acs-display-name]");
  const realEstateInput = $("[data-acs-real-estate]");
  const notesInput = $("[data-acs-notes]");
  const editorTitle = $("[data-acs-editor-title]");
  const peopleSearchInput = $("[data-acs-people-search]");
  const filterGroupInput = $("[data-acs-filter-group]");
  const filterRoleInput = $("[data-acs-filter-role]");
  const filterStateInput = $("[data-acs-filter-state]");
  const groupEditorTitle = $("[data-acs-group-editor-title]");
  const groupIdInput = $("[data-acs-group-id]");
  const groupLabelInput = $("[data-acs-group-label]");
  const groupKindInput = $("[data-acs-group-kind]");
  const groupGalleryKindInput = $("[data-acs-group-gallery-kind]");
  const groupGalleryKeyInput = $("[data-acs-group-gallery-key]");
  const groupPolicyInput = $("[data-acs-group-policy]");
  const membershipTitle = $("[data-acs-membership-title]");
  const memberEmailsInput = $("[data-acs-member-emails]");
  const addMembersButton = $("[data-acs-add-members]");
  let groupIdEdited = false;
  let groupGalleryKeyEdited = false;

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

  const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

  const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));

  const parseMemberEntries = (value) => {
    const seen = new Set();
    return String(value || "")
      .split(/[\n;]+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const angleMatch = line.match(/^(.*?)<([^>]+)>/);
        const email = normalizeEmail(angleMatch ? angleMatch[2] : line.split(/[,\s]+/).find((part) => part.includes("@")));
        const displayName = angleMatch ? angleMatch[1].trim().replace(/^["']|["']$/g, "") : "";
        return { email, displayName };
      })
      .filter((entry) => validEmail(entry.email))
      .filter((entry) => {
        if (seen.has(entry.email)) return false;
        seen.add(entry.email);
        return true;
      });
  };

  const slugify = (value) => String(value || "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const roleClass = (role) => role === "owner" ? " is-owner" : "";

  const capabilityLabel = (capabilityId) =>
    state.capabilities.find((capability) => capability.id === capabilityId)?.label || capabilityId;

  const groupLabel = (groupId) =>
    state.audienceGroups.find((group) => group.id === groupId)?.label || groupId;

  const activeAudienceGroups = () => state.audienceGroups.filter((group) => group.state !== "archived");

  const selectedGroup = () => state.audienceGroups.find((group) => group.id === state.selectedGroupId) || null;

  const groupMembers = (groupId) => state.people.filter((user) => (user.groupIds || []).includes(groupId));

  const personPayloadFor = (user = {}, overrides = {}) => {
    const roles = Array.isArray(user.roles) && user.roles.length ? user.roles : ["user"];
    return {
      email: overrides.email || user.email || "",
      displayName: overrides.displayName ?? user.displayName ?? "",
      roles: [...new Set(["user", ...roles.filter((role) => ["user", "owner", "re_client"].includes(role))])],
      realEstateClients: overrides.realEstateClients || user.realEstateClients || [],
      groupIds: overrides.groupIds || user.groupIds || [],
      notes: overrides.notes ?? user.notes ?? "",
      fixture: user.fixture === true,
    };
  };

  const filteredPeople = () => {
    const search = state.filters.search.trim().toLowerCase();
    return state.people.filter((user) => {
      if (search) {
        const haystack = [
          user.email,
          user.displayName,
          user.notes,
          ...(user.groups || []).map((group) => group.label || group.id),
        ].join(" ").toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      if (state.filters.groupId && !(user.groupIds || []).includes(state.filters.groupId)) return false;
      if (state.filters.role) {
        const roles = user.roles || [];
        if (state.filters.role === "user") {
          if (roles.includes("owner") || roles.includes("re_client")) return false;
        } else if (!roles.includes(state.filters.role)) {
          return false;
        }
      }
      if (state.filters.state === "disabled" && !user.disabledAt) return false;
      if (state.filters.state === "fixture" && !user.fixture) return false;
      if (state.filters.state === "active" && (user.disabledAt || user.fixture)) return false;
      return true;
    });
  };

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
    renderChoiceList(groupsRoot, activeAudienceGroups(), "acs-group", "data-acs-group", "Seed fixtures to load audience groups.");
    renderChoiceList(
      galleryOptionsRoot,
      state.galleryOptions.filter((option) => option.galleryKind === "real_estate"),
      "acs-gallery",
      "data-acs-gallery",
      "Seed fixtures to load RE gallery options."
    );
  };

  const renderPeopleFilters = () => {
    if (peopleSearchInput) peopleSearchInput.value = state.filters.search;
    if (filterGroupInput) {
      const current = state.filters.groupId;
      filterGroupInput.innerHTML = [
        `<option value="">All groups</option>`,
        ...state.audienceGroups.map((group) => {
          const suffix = group.state === "archived" ? " (archived)" : "";
          return `<option value="${escapeHtml(group.id)}">${escapeHtml((group.label || group.id) + suffix)}</option>`;
        }),
      ].join("");
      filterGroupInput.value = state.audienceGroups.some((group) => group.id === current) ? current : "";
      state.filters.groupId = filterGroupInput.value;
    }
    if (filterRoleInput) filterRoleInput.value = state.filters.role;
    if (filterStateInput) filterStateInput.value = state.filters.state;
  };

  const renderFilterSummary = (people) => {
    if (!filterSummaryRoot) return;
    const activeFilters = [
      state.filters.search ? "search" : "",
      state.filters.groupId ? groupLabel(state.filters.groupId) : "",
      state.filters.role ? state.filters.role : "",
      state.filters.state ? state.filters.state : "",
    ].filter(Boolean);
    filterSummaryRoot.textContent = activeFilters.length
      ? `${people.length} of ${state.people.length} people shown`
      : `${state.people.length} people shown`;
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
    setCount("groups", activeAudienceGroups().length);
    setCount("fixtures", people.filter((user) => user.fixture).length);
    setCount("disabled", people.filter((user) => user.disabledAt).length);
  };

  const renderPeople = () => {
    if (!peopleRoot) return;
    const people = filteredPeople();
    renderFilterSummary(people);
    if (!state.people.length) {
      peopleRoot.innerHTML = `<tr><td colspan="4" class="acs-empty">No people are stored yet. Seed fixtures or add a person.</td></tr>`;
      return;
    }
    if (!people.length) {
      peopleRoot.innerHTML = `<tr><td colspan="4" class="acs-empty">No people match these filters.</td></tr>`;
      return;
    }
    peopleRoot.innerHTML = people.map((user) => {
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

  const renderGroupCapabilities = () => {
    if (!groupCapabilitiesRoot) return;
    if (!state.capabilities.length) {
      groupCapabilitiesRoot.innerHTML = `<p class="acs-empty">No capability metadata loaded.</p>`;
      return;
    }
    groupCapabilitiesRoot.innerHTML = state.capabilities.map((capability) => {
      const id = `acs-group-capability-${capability.id}`.replace(/[^a-z0-9_-]+/gi, "-");
      return `
        <label for="${escapeHtml(id)}">
          <input id="${escapeHtml(id)}" type="checkbox" data-acs-group-capability="${escapeHtml(capability.id)}"/>
          <span>
            <strong>${escapeHtml(capability.label || capability.id)}</strong>
            <small>${escapeHtml(capability.id)}</small>
          </span>
        </label>
      `;
    }).join("");
  };

  const fillGroupForm = (group = null) => {
    const item = group || {};
    groupIdEdited = Boolean(item.id);
    groupGalleryKeyEdited = Boolean(item.id);
    if (groupIdInput) {
      groupIdInput.value = item.id || "";
      groupIdInput.readOnly = Boolean(item.id);
    }
    if (groupLabelInput) groupLabelInput.value = item.label || "";
    if (groupKindInput) groupKindInput.value = item.kind || "event";
    if (groupGalleryKindInput) groupGalleryKindInput.value = item.galleryKind || item.kind || "event";
    if (groupGalleryKeyInput) groupGalleryKeyInput.value = item.galleryKey || item.id || "";
    if (groupPolicyInput) groupPolicyInput.value = item.accessPolicy || "";
    const capabilities = new Set(item.capabilities || []);
    document.querySelectorAll("[data-acs-group-capability]").forEach((input) => {
      input.checked = capabilities.has(input.dataset.acsGroupCapability);
    });
    if (groupEditorTitle) groupEditorTitle.textContent = item.id ? item.label || item.id : "New audience group";
    const archiveButton = $("[data-acs-archive-group]");
    if (archiveButton) archiveButton.disabled = !item.id || item.state === "archived";
  };

  const renderGroupList = () => {
    if (!groupListRoot) return;
    if (!state.audienceGroups.length) {
      groupListRoot.innerHTML = `<p class="acs-empty">No audience groups yet. Seed fixtures or save a group.</p>`;
      return;
    }
    groupListRoot.innerHTML = state.audienceGroups.map((group) => {
      const active = group.id === state.selectedGroupId;
      const archived = group.state === "archived";
      return `
        <button type="button" class="acs-group-row${active ? " is-active" : ""}${archived ? " is-archived" : ""}" data-acs-group-row="${escapeHtml(group.id)}">
          <span>
            <strong>${escapeHtml(group.label || group.id)}</strong>
            <small>${escapeHtml([group.kind, group.galleryKind, group.galleryKey].filter(Boolean).join(" / "))}</small>
          </span>
          <span class="acs-group-row-chips">
            <span class="acs-chip${archived ? " is-disabled" : ""}">${escapeHtml(archived ? "archived" : "active")}</span>
            ${group.fixture ? `<span class="acs-chip is-fixture">fixture</span>` : ""}
          </span>
        </button>
      `;
    }).join("");
  };

  const renderMembership = () => {
    if (!memberListRoot) return;
    const group = selectedGroup();
    if (addMembersButton) addMembersButton.disabled = !group?.id || group.state === "archived";
    if (memberEmailsInput) memberEmailsInput.disabled = !group?.id || group.state === "archived";
    if (!group?.id) {
      if (membershipTitle) membershipTitle.textContent = "Group members";
      memberListRoot.innerHTML = `<p class="acs-empty">Select a group to manage memberships.</p>`;
      return;
    }
    const members = groupMembers(group.id);
    if (membershipTitle) membershipTitle.textContent = `${group.label || group.id} members`;
    const archivedNote = group.state === "archived"
      ? `<p class="acs-empty">Archived groups cannot receive new members.</p>`
      : "";
    if (!members.length) {
      memberListRoot.innerHTML = `${archivedNote}<p class="acs-empty">No members assigned.</p>`;
      return;
    }
    memberListRoot.innerHTML = `${archivedNote}${members.map((user) => `
      <article class="acs-member-row">
        <div>
          <strong>${escapeHtml(user.displayName || user.email)}</strong>
          <small>${escapeHtml(user.email)}</small>
          ${formatRoles(user)}
        </div>
        <div class="acs-member-actions">
          ${personState(user)}
          <button class="btn secondary" type="button" data-acs-edit-member="${escapeHtml(user.email)}">Edit</button>
          <button class="btn secondary danger" type="button" data-acs-revoke-membership="${escapeHtml(user.email)}" ${group.state === "archived" ? "disabled" : ""}>Revoke</button>
        </div>
      </article>
    `).join("")}`;
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
      kind: [group.kind || "group", group.state === "archived" ? "archived" : ""].filter(Boolean).join(" / "),
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
    renderPeopleFilters();
    renderPeople();
    renderEvents();
    renderGroupCapabilities();
    renderGroupList();
    renderMembership();
    fillGroupForm(selectedGroup());
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
      if (!state.selectedGroupId || !state.audienceGroups.some((group) => group.id === state.selectedGroupId)) {
        state.selectedGroupId = state.audienceGroups[0]?.id || "";
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
      state.selectedGroupId = "";
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

  const saveGroup = async () => {
    const existing = selectedGroup();
    const label = groupLabelInput?.value || "";
    const generatedId = slugify(label);
    const payload = {
      id: groupIdInput?.value || existing?.id || generatedId,
      label,
      kind: groupKindInput?.value || "event",
      galleryKind: groupGalleryKindInput?.value || "event",
      galleryKey: groupGalleryKeyInput?.value || groupIdInput?.value || generatedId,
      accessPolicy: groupPolicyInput?.value || "",
      capabilities: checkedValues("[data-acs-group-capability]", "acsGroupCapability"),
      fixture: existing?.fixture === true,
    };
    setStatus(`Saving group ${payload.label || payload.id || ""}...`);
    const body = await apiFetch("/access-console/groups", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    state.selectedGroupId = body.group?.id || payload.id;
    await load();
  };

  const archiveSelectedGroup = async () => {
    const group = selectedGroup();
    if (!group?.id) {
      setStatus("Select a group before archiving.");
      return;
    }
    if (group.state === "archived") {
      setStatus(`${group.label || group.id} is already archived.`);
      return;
    }
    if (!window.confirm?.(`Archive ${group.label || group.id}? Active memberships will be revoked, but the audit record stays visible.`)) return;
    setStatus(`Archiving group ${group.label || group.id}...`);
    await apiFetch(`/access-console/groups/${encodeURIComponent(group.id)}/archive`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    await load();
  };

  const addMembersToSelectedGroup = async () => {
    const group = selectedGroup();
    if (!group?.id) {
      setStatus("Select a group before adding members.");
      return;
    }
    if (group.state === "archived") {
      setStatus(`${group.label || group.id} is archived.`);
      return;
    }
    const entries = parseMemberEntries(memberEmailsInput?.value || "");
    if (!entries.length) {
      setStatus("Enter at least one valid email address.");
      return;
    }
    let added = 0;
    let skipped = 0;
    for (const entry of entries) {
      const existing = state.people.find((user) => user.email === entry.email);
      const groupIds = new Set(existing?.groupIds || []);
      if (groupIds.has(group.id)) {
        skipped += 1;
        continue;
      }
      groupIds.add(group.id);
      await apiFetch("/access-console/people", {
        method: "POST",
        body: JSON.stringify(personPayloadFor(existing || {}, {
          email: entry.email,
          displayName: existing?.displayName || entry.displayName || "",
          groupIds: [...groupIds],
        })),
      });
      added += 1;
    }
    if (memberEmailsInput) memberEmailsInput.value = "";
    setStatus(`Added ${added} member${added === 1 ? "" : "s"} to ${group.label || group.id}${skipped ? `; ${skipped} already assigned` : ""}.`);
    state.filters.groupId = group.id;
    await load();
  };

  const revokeMembership = async (email) => {
    const group = selectedGroup();
    const user = state.people.find((item) => item.email === email);
    if (!group?.id || !user?.email) {
      setStatus("Select a group member before revoking.");
      return;
    }
    if (group.state === "archived") {
      setStatus(`${group.label || group.id} is archived.`);
      return;
    }
    if (!window.confirm?.(`Revoke ${group.label || group.id} access for ${user.email}?`)) return;
    const groupIds = (user.groupIds || []).filter((groupId) => groupId !== group.id);
    setStatus(`Revoking ${group.label || group.id} access for ${user.email}...`);
    await apiFetch("/access-console/people", {
      method: "POST",
      body: JSON.stringify(personPayloadFor(user, { groupIds })),
    });
    state.selectedEmail = user.email;
    state.filters.groupId = group.id;
    await load();
  };

  const showSelectedGroupMembers = () => {
    const group = selectedGroup();
    if (!group?.id) {
      setStatus("Select a group before filtering members.");
      return;
    }
    state.filters = {
      search: "",
      groupId: group.id,
      role: "",
      state: "",
    };
    render();
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

  groupListRoot?.addEventListener("click", (event) => {
    const row = event.target.closest("[data-acs-group-row]");
    if (!row) return;
    state.selectedGroupId = row.dataset.acsGroupRow || "";
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

  groupForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await saveGroup();
    } catch (error) {
      setStatus(error.message || "Could not save group.");
    }
  });

  memberForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await addMembersToSelectedGroup();
    } catch (error) {
      setStatus(error.message || "Could not add members.");
    }
  });

  memberListRoot?.addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-acs-edit-member]");
    if (editButton) {
      state.selectedEmail = editButton.dataset.acsEditMember || "";
      render();
      return;
    }
    const revokeButton = event.target.closest("[data-acs-revoke-membership]");
    if (revokeButton) {
      revokeMembership(revokeButton.dataset.acsRevokeMembership || "")
        .catch((error) => setStatus(error.message || "Could not revoke membership."));
    }
  });

  $("[data-acs-refresh]")?.addEventListener("click", () => load());
  peopleSearchInput?.addEventListener("input", () => {
    state.filters.search = peopleSearchInput.value || "";
    renderPeople();
  });
  filterGroupInput?.addEventListener("change", () => {
    state.filters.groupId = filterGroupInput.value || "";
    if (state.filters.groupId) state.selectedGroupId = state.filters.groupId;
    render();
  });
  filterRoleInput?.addEventListener("change", () => {
    state.filters.role = filterRoleInput.value || "";
    renderPeople();
  });
  filterStateInput?.addEventListener("change", () => {
    state.filters.state = filterStateInput.value || "";
    renderPeople();
  });
  $("[data-acs-clear-filters]")?.addEventListener("click", () => {
    state.filters = { search: "", groupId: "", role: "", state: "" };
    render();
  });
  $("[data-acs-new-person]")?.addEventListener("click", () => {
    state.selectedEmail = "";
    fillForm(null);
    renderPeople();
    renderEffectiveAccess();
  });
  $("[data-acs-new-group]")?.addEventListener("click", () => {
    state.selectedGroupId = "";
    fillGroupForm(null);
    renderGroupList();
  });
  groupIdInput?.addEventListener("input", () => {
    groupIdEdited = true;
  });
  groupGalleryKeyInput?.addEventListener("input", () => {
    groupGalleryKeyEdited = true;
  });
  groupLabelInput?.addEventListener("input", () => {
    if (state.selectedGroupId) return;
    const generated = slugify(groupLabelInput.value);
    if (groupIdInput && !groupIdEdited) groupIdInput.value = generated;
    if (groupGalleryKeyInput && !groupGalleryKeyEdited) groupGalleryKeyInput.value = generated;
  });
  $("[data-acs-disable-person]")?.addEventListener("click", () => disableSelected().catch((error) => setStatus(error.message || "Could not disable person.")));
  $("[data-acs-archive-group]")?.addEventListener("click", () => archiveSelectedGroup().catch((error) => setStatus(error.message || "Could not archive group.")));
  $("[data-acs-filter-selected-group]")?.addEventListener("click", showSelectedGroupMembers);
  $("[data-acs-seed-fixtures]")?.addEventListener("click", () => seedFixtures().catch((error) => setStatus(error.message || "Could not seed fixtures.")));
  $("[data-acs-login]")?.addEventListener("click", login);
  $("[data-acs-logout]")?.addEventListener("click", logout);
  themeToggle?.addEventListener("click", toggleTheme);

  syncThemeToggle();
  load();
})();
