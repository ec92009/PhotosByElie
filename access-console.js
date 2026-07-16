(() => {
  const cleanBase = (value) => String(value || "").trim().replace(/\/+$/, "");
  const mediaConfig = window.photosByElieMediaConfig || {};
  const workerBase = cleanBase(mediaConfig.authWorkerBaseUrl || mediaConfig.checkoutWorkerBaseUrl || "");
  const AUTH_TOKEN_HASH_PARAM = "pbe_auth_token";
  const AUTH_TOKEN_STORAGE_KEY = "pbe-access-console-auth-token";
  const state = {
    people: [],
    fixtureEvents: [],
    audienceGroups: [],
    galleryOptions: [],
    capabilities: [],
    auditEvents: [],
    realEstateCredentials: [],
    roles: [],
    selectedEmail: "",
    selectedGroupId: "",
    filters: {
      search: "",
      groupId: "",
      role: "",
      state: "",
    },
    accessPreviewMode: "group",
    ownerOriginals: false,
    policyResult: null,
    policyBusy: false,
    undoBusy: false,
    inviteOutput: null,
    session: null,
  };
  const BASE_USER_CAPABILITIES = ["view_public", "buy_downloads", "redownload_purchases_30d"];
  const OWNER_PREVIEW_CAPABILITIES = ["view_all_galleries", "view_originals", "manage_access"];
  const DEFAULT_GALLERY_DEFAULTS = {
    watermarked: true,
    saleEnabled: true,
    downloads: false,
    pdf: false,
    video: false,
    memberOriginals: false,
    ownerOriginals: false,
  };
  const PUBLIC_GALLERY_DEFAULTS = {
    ...DEFAULT_GALLERY_DEFAULTS,
    ownerOriginals: true,
  };
  const EVENT_GALLERY_DEFAULTS = {
    ...DEFAULT_GALLERY_DEFAULTS,
    downloads: true,
    ownerOriginals: true,
  };
  const RE_GALLERY_DEFAULTS = {
    ...DEFAULT_GALLERY_DEFAULTS,
    saleEnabled: false,
    pdf: true,
    video: true,
    memberOriginals: true,
    ownerOriginals: true,
  };
  const KNOWN_GALLERY_RECORDS = [
    { id: "public:ai", label: "AI", kind: "custom", galleryKind: "public", galleryKey: "ai", count: 5076, defaults: PUBLIC_GALLERY_DEFAULTS },
    { id: "public:france", label: "France", kind: "custom", galleryKind: "public", galleryKey: "france", count: 379, defaults: PUBLIC_GALLERY_DEFAULTS },
    { id: "public:italy", label: "Italy", kind: "custom", galleryKind: "public", galleryKey: "italy", count: 70, defaults: PUBLIC_GALLERY_DEFAULTS },
    { id: "public:mexico", label: "Mexico", kind: "custom", galleryKind: "public", galleryKey: "mexico", count: 31, defaults: PUBLIC_GALLERY_DEFAULTS },
    { id: "public:portugal", label: "Portugal", kind: "custom", galleryKind: "public", galleryKey: "portugal", count: 214, defaults: PUBLIC_GALLERY_DEFAULTS },
    { id: "public:slovakia", label: "Slovakia", kind: "custom", galleryKind: "public", galleryKey: "slovakia", count: 2, defaults: PUBLIC_GALLERY_DEFAULTS },
    { id: "public:spain", label: "Spain", kind: "custom", galleryKind: "public", galleryKey: "spain", count: 1853, defaults: PUBLIC_GALLERY_DEFAULTS },
    { id: "public:usa", label: "USA", kind: "custom", galleryKind: "public", galleryKey: "usa", count: 145, defaults: PUBLIC_GALLERY_DEFAULTS },
    { id: "event:agnes-bday", label: "Agnes's B'day", kind: "family", galleryKind: "event", galleryKey: "agnes-bday", defaults: EVENT_GALLERY_DEFAULTS },
    { id: "real_estate:corine-real-estate", label: "RE La Concha", kind: "real_estate", galleryKind: "real_estate", galleryKey: "corine-real-estate", defaults: RE_GALLERY_DEFAULTS },
    { id: "event:johnson-palmer-wedding", label: "Johnson-Palmer wedding", kind: "event", galleryKind: "event", galleryKey: "johnson-palmer-wedding", defaults: EVENT_GALLERY_DEFAULTS },
  ];

  const $ = (selector) => document.querySelector(selector);
  const root = $("[data-acs-root]");
  const statusRoot = $("[data-acs-status]");
  const sessionRoot = $("[data-acs-session]");
  const peopleRoot = $("[data-acs-people]");
  const eventsRoot = $("[data-acs-events]");
  const auditRoot = $("[data-acs-audit]");
  const auditStatusRoot = $("[data-acs-audit-status]");
  const groupsRoot = $("[data-acs-groups]");
  const groupListRoot = $("[data-acs-group-list]");
  const memberListRoot = $("[data-acs-member-list]");
  const galleryAccessRoot = $("[data-acs-gallery-access]");
  const galleryAccessSummaryRoot = $("[data-acs-access-summary]");
  const policyTestButton = $("[data-acs-policy-test]");
  const policyStatusRoot = $("[data-acs-policy-status]");
  const policyResultRoot = $("[data-acs-policy-result]");
  const galleryOptionsRoot = $("[data-acs-gallery-options]");
  const effectiveAccessRoot = $("[data-acs-effective-access]");
  const capabilitiesRoot = $("[data-acs-capabilities]");
  const groupCapabilitiesRoot = $("[data-acs-group-capabilities]");
  const filterSummaryRoot = $("[data-acs-filter-summary]");
  const workerBaseRoot = $("[data-acs-worker-base]");
  const form = $("[data-acs-person-form]");
  const groupForm = $("[data-acs-group-form]");
  const memberForm = $("[data-acs-member-form]");
  const emailInput = $("[data-acs-email]");
  const displayNameInput = $("[data-acs-display-name]");
  const realEstateInput = $("[data-acs-real-estate]");
  const notesInput = $("[data-acs-notes]");
  const passwordLoginNameInput = $("[data-acs-password-login-name]");
  const passwordLoginPasswordInput = $("[data-acs-password-login-password]");
  const passwordLoginStatus = $("[data-acs-password-login-status]");
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
  const groupGalleryRecordInput = $("[data-acs-gallery-record]");
  const groupPolicyInput = $("[data-acs-group-policy]");
  const membershipTitle = $("[data-acs-membership-title]");
  const memberEmailsInput = $("[data-acs-member-emails]");
  const addMembersButton = $("[data-acs-add-members]");
  const inviteTitle = $("[data-acs-invite-title]");
  const inviteSummaryRoot = $("[data-acs-invite-summary]");
  const inviteForm = $("[data-acs-invite-form]");
  const inviteEmailsInput = $("[data-acs-invite-emails]");
  const inviteOutputRoot = $("[data-acs-invite-output]");
  const copyInviteLinkButton = $("[data-acs-copy-invite-link]");
  const showInviteQrButton = $("[data-acs-show-invite-qr]");
  const accessPreviewInput = $("[data-acs-access-preview]");
  const ownerOriginalsInput = $("[data-acs-owner-originals]");
  let groupIdEdited = false;
  let groupGalleryKeyEdited = false;

  const setStatus = (message) => {
    if (statusRoot) statusRoot.textContent = message;
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

  const knownGalleryRecords = () => {
    const audienceRecords = state.audienceGroups.map((group) => ({
      id: `${group.galleryKind || group.kind || "custom"}:${group.galleryKey || group.id}`,
      label: group.label || group.id,
      kind: group.kind || "event",
      galleryKind: group.galleryKind || group.kind || "event",
      galleryKey: group.galleryKey || group.id,
      defaults: group.galleryDefaults,
    }));
    const records = new Map();
    [...KNOWN_GALLERY_RECORDS, ...audienceRecords].forEach((record) => {
      if (!record.galleryKey) return;
      records.set(`${record.galleryKind}:${record.galleryKey}`, record);
    });
    return [...records.values()];
  };

  const galleryRecordKeyFor = (item = {}) =>
    item.galleryKind && item.galleryKey ? `${item.galleryKind}:${item.galleryKey}` : "";

  const galleryRecordFor = (item = {}) =>
    knownGalleryRecords().find((record) => galleryRecordKeyFor(record) === galleryRecordKeyFor(item)) || null;

  const normalizeGalleryDefaults = (value = {}, capabilities = [], group = {}) => {
    const source = value && typeof value === "object" ? value : {};
    const caps = new Set(Array.isArray(capabilities) ? capabilities : []);
    const bool = (key, fallback) => source[key] === true || source[key] === 1 || source[key] === "1"
      ? true
      : (source[key] === false || source[key] === 0 || source[key] === "0" ? false : fallback);
    return {
      ...DEFAULT_GALLERY_DEFAULTS,
      watermarked: bool("watermarked", caps.has("view_watermarked")),
      saleEnabled: bool("saleEnabled", (group.galleryKind || group.kind) !== "real_estate"),
      downloads: bool("downloads", caps.has("download_items")),
      pdf: bool("pdf", caps.has("pdf")),
      video: bool("video", caps.has("video")),
      memberOriginals: bool("memberOriginals", caps.has("view_originals")),
      ownerOriginals: bool("ownerOriginals", false),
    };
  };

  const defaultsToCapabilities = (defaults = {}) => {
    const normalized = normalizeGalleryDefaults(defaults);
    return [
      "view_gallery",
      normalized.watermarked ? "view_watermarked" : "",
      normalized.saleEnabled ? "buy_downloads" : "",
      normalized.downloads ? "download_items" : "",
      normalized.pdf ? "pdf" : "",
      normalized.video ? "video" : "",
      normalized.memberOriginals ? "view_originals" : "",
    ].filter(Boolean);
  };

  const galleryDefaultsFromForm = () => {
    const defaults = { ...DEFAULT_GALLERY_DEFAULTS };
    document.querySelectorAll("[data-acs-gallery-default]").forEach((input) => {
      defaults[input.dataset.acsGalleryDefault] = Boolean(input.checked);
    });
    return defaults;
  };

  const fillGalleryDefaults = (defaults = {}) => {
    const normalized = normalizeGalleryDefaults(defaults);
    document.querySelectorAll("[data-acs-gallery-default]").forEach((input) => {
      input.checked = Boolean(normalized[input.dataset.acsGalleryDefault]);
    });
  };

  const syncCapabilitiesFromDefaults = () => {
    const defaults = galleryDefaultsFromForm();
    const wanted = new Set(defaultsToCapabilities(defaults));
    document.querySelectorAll("[data-acs-group-capability]").forEach((input) => {
      const capability = input.dataset.acsGroupCapability;
      if (["view_gallery", "view_watermarked", "buy_downloads", "download_items", "pdf", "video", "view_originals"].includes(capability)) {
        input.checked = wanted.has(capability);
      }
    });
  };

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

  const capabilitySet = (capabilities = [], { ownerOriginals = false } = {}) => {
    const set = new Set(Array.isArray(capabilities) ? capabilities : []);
    if (ownerOriginals) set.add("view_originals");
    return set;
  };

  const permissionRows = (capabilities, { ownerOriginals = false } = {}) => {
    const set = capabilitySet(capabilities, { ownerOriginals });
    const originals = set.has("view_originals");
    const watermarked = set.has("view_watermarked");
    return [
      ["Gallery", set.has("view_all_galleries") ? "All galleries" : (set.has("view_gallery") ? "Assigned gallery" : "Public galleries")],
      ["Preview", originals ? "Full-res available" : (watermarked ? "Watermarked" : "Compressed/public")],
      ["Downloads", set.has("download_items") ? "Assigned items" : (set.has("redownload_purchases_30d") ? "Purchased re-downloads" : "No direct downloads")],
      ["Checkout", set.has("buy_downloads") ? "Enabled" : "No sales"],
      ["PDF", set.has("pdf") ? "Granted" : "No"],
      ["Video", set.has("video") ? "Granted" : "No"],
      ["Originals", originals ? (ownerOriginals ? "Owner switch on" : "Granted") : "No"],
      ["Access", set.has("manage_access") ? "Can manage" : "Viewer"],
    ];
  };

  const accessCard = ({ title, meta, capabilities = [], policy = "", people = "", ownerOriginals: ownerOriginalsOverride = null }) => {
    const ownerOriginals = ownerOriginalsOverride == null
      ? state.accessPreviewMode !== "visitor" && (state.ownerOriginals || state.accessPreviewMode === "owner")
      : Boolean(ownerOriginalsOverride);
    const effectiveCapabilities = [...capabilitySet(capabilities, {
      ownerOriginals,
    })];
    const rows = permissionRows(effectiveCapabilities, { ownerOriginals });
    return `
      <article class="acs-access-card">
        <header>
          <strong>${escapeHtml(title)}</strong>
          ${meta ? `<small>${escapeHtml(meta)}</small>` : ""}
        </header>
        ${policy ? `<small>${escapeHtml(policy)}</small>` : ""}
        <dl class="acs-policy-grid">
          ${rows.map(([term, value]) => `
            <div>
              <dt>${escapeHtml(term)}</dt>
              <dd>${escapeHtml(value)}</dd>
            </div>
          `).join("")}
        </dl>
        ${formatCapabilityChips(effectiveCapabilities)}
        ${people ? `<small>${escapeHtml(people)}</small>` : ""}
      </article>
    `;
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
    const passwordCount = credentialsFor(user?.email || "").filter((credential) => credential.state === "active" && credential.passwordSet).length;
    if (!galleries.length && !passwordCount) return `<span class="acs-person-meta">public only</span>`;
    return `<span class="acs-gallery-stack">${galleries.map((key) => `<span class="acs-chip">${escapeHtml(key)}</span>`).join("")}${passwordCount ? `<span class="acs-chip is-ok">password login</span>` : ""}</span>`;
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
    if (groupGalleryRecordInput) {
      const selectedValue = groupGalleryRecordInput.value;
      groupGalleryRecordInput.innerHTML = [
        `<option value="">Custom gallery key</option>`,
        ...knownGalleryRecords().map((record) => {
          const detail = [
            record.galleryKind,
            record.galleryKey,
            Number.isFinite(Number(record.count)) ? `${record.count} items` : "",
          ].filter(Boolean).join(" / ");
          return `<option value="${escapeHtml(galleryRecordKeyFor(record))}">${escapeHtml(record.label)}${detail ? ` - ${escapeHtml(detail)}` : ""}</option>`;
        }),
      ].join("");
      groupGalleryRecordInput.value = [...groupGalleryRecordInput.options].some((option) => option.value === selectedValue)
        ? selectedValue
        : "";
    }
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

  const credentialsFor = (email) => state.realEstateCredentials.filter((credential) => credential.email === email);

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
    const credentials = credentialsFor(item.email || "");
    if (passwordLoginNameInput) passwordLoginNameInput.value = credentials[0]?.loginName || item.displayName || "";
    if (passwordLoginPasswordInput) passwordLoginPasswordInput.value = "";
    if (passwordLoginStatus) {
      passwordLoginStatus.textContent = credentials.length
        ? `Password set for ${credentials.map((credential) => credential.galleryKey).join(", ")}.`
        : "No password login stored.";
    }
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
    if (groupGalleryRecordInput) {
      const recordKey = galleryRecordKeyFor(item);
      groupGalleryRecordInput.value = [...groupGalleryRecordInput.options].some((option) => option.value === recordKey)
        ? recordKey
        : "";
    }
    if (groupPolicyInput) groupPolicyInput.value = item.accessPolicy || "";
    const capabilities = new Set(item.capabilities || []);
    document.querySelectorAll("[data-acs-group-capability]").forEach((input) => {
      input.checked = capabilities.has(input.dataset.acsGroupCapability);
    });
    fillGalleryDefaults(item.galleryDefaults || normalizeGalleryDefaults({}, item.capabilities || [], item));
    if (groupEditorTitle) groupEditorTitle.textContent = item.id ? item.label || item.id : "New audience group";
    const archiveButton = $("[data-acs-archive-group]");
    if (archiveButton) archiveButton.disabled = !item.id || item.state === "archived";
  };

  const applyGalleryRecord = (record) => {
    if (!record) return;
    if (groupLabelInput && !state.selectedGroupId && !groupLabelInput.value) groupLabelInput.value = record.label || "";
    if (groupKindInput) groupKindInput.value = record.kind || "event";
    if (groupGalleryKindInput) groupGalleryKindInput.value = record.galleryKind || record.kind || "event";
    if (groupGalleryKeyInput) groupGalleryKeyInput.value = record.galleryKey || "";
    if (groupIdInput && !state.selectedGroupId && !groupIdEdited) groupIdInput.value = slugify(record.label || record.galleryKey || "");
    if (groupPolicyInput && !groupPolicyInput.value && record.accessPolicy) groupPolicyInput.value = record.accessPolicy;
    groupGalleryKeyEdited = true;
    fillGalleryDefaults(record.defaults || record.galleryDefaults || {});
    syncCapabilitiesFromDefaults();
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

  const inviteScopeFor = (group = {}) =>
    [group.galleryKind || group.kind || "event", group.galleryKey || group.id || ""].filter(Boolean).join(":");

  const previewInviteTokenFor = (group = {}, channel = "link", seed = "") => {
    const source = `${group.id || ""}|${group.galleryKey || ""}|${channel}|${seed}`;
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `preview-${(hash >>> 0).toString(36)}`;
  };

  const inviteUrlFor = (group = {}, channel = "link", seed = "") => {
    const url = new URL("/invite/preview", "https://photos-by-elie.com");
    url.searchParams.set("token", previewInviteTokenFor(group, channel, seed));
    url.searchParams.set("channel", channel);
    url.searchParams.set("scope", inviteScopeFor(group));
    return url.href;
  };

  const invitationOutputCard = ({ title, meta, body, code = "", chips = [] }) => `
    <article class="acs-invite-card">
      <header>
        <strong>${escapeHtml(title)}</strong>
        ${meta ? `<small>${escapeHtml(meta)}</small>` : ""}
      </header>
      ${body ? `<p>${escapeHtml(body)}</p>` : ""}
      ${code ? `<code class="acs-invite-link">${escapeHtml(code)}</code>` : ""}
      ${chips.length ? `<span class="acs-gallery-stack">${chips.map((chip) => `<span class="acs-chip">${escapeHtml(chip)}</span>`).join("")}</span>` : ""}
    </article>
  `;

  const renderInvitation = () => {
    if (!inviteSummaryRoot || !inviteOutputRoot) return;
    const group = selectedGroup();
    const archived = group?.state === "archived";
    const disabled = !group?.id || archived;
    [inviteEmailsInput, copyInviteLinkButton, showInviteQrButton].forEach((node) => {
      if (node) node.disabled = disabled;
    });
    const prepareButton = $("[data-acs-prepare-email-invites]");
    if (prepareButton) prepareButton.disabled = disabled;

    if (!group?.id) {
      if (inviteTitle) inviteTitle.textContent = "Invite access";
      inviteSummaryRoot.textContent = "Select a group before preparing invitations.";
      inviteOutputRoot.innerHTML = `<p class="acs-empty">Invitation rehearsals are scoped to one selected fixture group.</p>`;
      return;
    }
    if (state.inviteOutput?.groupId !== group.id) state.inviteOutput = null;
    if (inviteTitle) inviteTitle.textContent = `${group.label || group.id} invites`;
    inviteSummaryRoot.textContent = archived
      ? "Archived groups cannot receive new invitation accepts."
      : "Active fixture members may invite others into this same gallery scope. They cannot un-invite; Owner/Admin revokes pending invites or memberships.";

    if (archived) {
      inviteOutputRoot.innerHTML = `<p class="acs-empty">Restore or recreate the group before issuing invitations.</p>`;
      return;
    }
    if (!state.inviteOutput) {
      inviteOutputRoot.innerHTML = invitationOutputCard({
        title: "Invite model",
        meta: inviteScopeFor(group),
        body: "Email invites are address-bound. Link and QR invites use the same scoped accept URL after Google sign-in.",
        chips: ["same fixture only", "no un-invite", "admin revoke"],
      });
      return;
    }

    const output = state.inviteOutput;
    if (output.kind === "email") {
      inviteOutputRoot.innerHTML = `
        ${invitationOutputCard({
          title: "Email invite batch",
          meta: `${output.recipients.length} recipient${output.recipients.length === 1 ? "" : "s"}`,
          body: "Each invite is bound to the recipient email. Accepting with a different Google account should be blocked.",
          chips: ["address-bound", "pending", "audited"],
        })}
        <div class="acs-invite-recipient-list">
          ${output.recipients.map((entry) => invitationOutputCard({
            title: entry.displayName || entry.email,
            meta: entry.email,
            code: inviteUrlFor(group, "email", entry.email),
          })).join("")}
        </div>
      `;
      return;
    }

    if (output.kind === "qr") {
      const url = inviteUrlFor(group, "qr");
      inviteOutputRoot.innerHTML = invitationOutputCard({
        title: "QR payload",
        meta: inviteScopeFor(group),
        body: "The production QR code should encode this same opaque, expiring invite URL.",
        code: url,
        chips: ["QR", "Google sign-in", "membership on accept"],
      });
      return;
    }

    inviteOutputRoot.innerHTML = invitationOutputCard({
      title: "Share link",
      meta: inviteScopeFor(group),
      body: "The link is fixture-scoped and should create membership only after the recipient signs in with Google.",
      code: inviteUrlFor(group, "link"),
      chips: ["copyable", "limited scope", "admin revoke"],
    });
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

  const renderAccessPreview = () => {
    if (!galleryAccessRoot) return;
    const validModes = new Set(["group", "person", "visitor", "owner"]);
    if (!validModes.has(state.accessPreviewMode)) state.accessPreviewMode = "group";
    if (accessPreviewInput) accessPreviewInput.value = state.accessPreviewMode;
    if (ownerOriginalsInput) {
      ownerOriginalsInput.checked = state.accessPreviewMode === "owner"
        || (state.accessPreviewMode !== "visitor" && state.ownerOriginals);
      ownerOriginalsInput.disabled = state.accessPreviewMode === "visitor";
    }

    const mode = state.accessPreviewMode;
    const cards = [];
    let summary = "";
    if (mode === "group") {
      const group = selectedGroup();
      if (!group?.id) {
        if (galleryAccessSummaryRoot) galleryAccessSummaryRoot.textContent = "Select a group to preview gallery permissions.";
        galleryAccessRoot.innerHTML = `<p class="acs-empty">No group selected.</p>`;
        return;
      }
      const members = groupMembers(group.id);
      const defaults = normalizeGalleryDefaults(group.galleryDefaults || {}, group.capabilities || [], group);
      const memberCapabilities = [...new Set([
        ...BASE_USER_CAPABILITIES,
        ...(group.capabilities || []),
        ...defaultsToCapabilities(defaults),
      ])];
      const ownerCapabilities = [...new Set([
        ...BASE_USER_CAPABILITIES,
        ...OWNER_PREVIEW_CAPABILITIES,
        "view_gallery",
        ...(defaults.watermarked ? ["view_watermarked"] : []),
        ...(defaults.downloads ? ["download_items"] : []),
        ...(defaults.pdf ? ["pdf"] : []),
        ...(defaults.video ? ["video"] : []),
      ])];
      const people = members.length
        ? `${members.length} member${members.length === 1 ? "" : "s"}: ${members.slice(0, 3).map((user) => user.email).join(", ")}${members.length > 3 ? ", ..." : ""}`
        : "No assigned members";
      summary = `${group.label || group.id} -> ${[group.kind, group.galleryKind, group.galleryKey].filter(Boolean).join(" / ")}`;
      cards.push(accessCard({
        title: "Regular visitor",
        meta: "user / public",
        capabilities: BASE_USER_CAPABILITIES,
        policy: "public browsing, checkout, and 30-day purchased-download recovery",
        ownerOriginals: false,
      }));
      cards.push(accessCard({
        title: `Assigned member: ${group.label || group.id}`,
        meta: [group.kind, group.galleryKind, group.galleryKey].filter(Boolean).join(" / "),
        capabilities: memberCapabilities,
        policy: group.accessPolicy || "",
        people,
        ownerOriginals: false,
      }));
      cards.push(accessCard({
        title: "Owner/admin",
        meta: defaults.ownerOriginals ? "owner switch / originals" : "owner switch / compressed",
        capabilities: ownerCapabilities,
        policy: defaults.ownerOriginals
          ? "owner inspection may use full-resolution unwatermarked originals"
          : "owner inspection defaults to the compressed or watermarked view",
        ownerOriginals: defaults.ownerOriginals || state.ownerOriginals,
      }));
    } else if (mode === "person") {
      const user = selectedUser();
      if (!user?.email) {
        if (galleryAccessSummaryRoot) galleryAccessSummaryRoot.textContent = "Select a person to preview their gallery permissions.";
        galleryAccessRoot.innerHTML = `<p class="acs-empty">No person selected.</p>`;
        return;
      }
      const scopes = Array.isArray(user.effectiveAccess?.scopes) ? user.effectiveAccess.scopes : [];
      summary = `${user.email} -> ${user.effectiveAccess?.summary || "Public galleries and account recovery"}`;
      scopes.forEach((scope) => {
        cards.push(accessCard({
          title: scope.label || scope.galleryKey || scope.role || "Access",
          meta: [scope.source, scope.galleryKind, scope.galleryKey].filter(Boolean).join(" / "),
          capabilities: scope.capabilities || [],
          policy: scope.accessPolicy || "",
        }));
      });
    } else if (mode === "owner") {
      summary = "Owner/admin preview -> all galleries, originals, and access management";
      cards.push(accessCard({
        title: "Owner/admin",
        meta: "owner / all",
        capabilities: [...BASE_USER_CAPABILITIES, ...OWNER_PREVIEW_CAPABILITIES],
        policy: "owner workflow access, full-gallery inspection, and access assignment",
      }));
    } else {
      summary = "Regular visitor -> public browsing, checkout, and purchased re-downloads";
      cards.push(accessCard({
        title: "Regular visitor",
        meta: "user / public",
        capabilities: BASE_USER_CAPABILITIES,
        policy: "public browsing, checkout, and 30-day purchased-download recovery",
      }));
    }

    if (galleryAccessSummaryRoot) galleryAccessSummaryRoot.textContent = summary;
    galleryAccessRoot.innerHTML = cards.length
      ? cards.join("")
      : `<p class="acs-empty">No gallery scopes found.</p>`;
  };

  const policyReasonLabel = (value) => String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

  const policyBool = (value) => value ? "Yes" : "No";

  const policyRows = (decision = {}) => {
    const access = decision.access || {};
    return [
      ["View", decision.allowed ? "Allowed" : "Blocked"],
      ["Preview", access.previewMode || "blocked"],
      ["Watermark", policyBool(access.watermarked)],
      ["Checkout", policyBool(access.checkout)],
      ["Downloads", policyBool(access.assignedDownloads)],
      ["Re-download", policyBool(access.purchasedRedownloads)],
      ["PDF", policyBool(access.pdf)],
      ["Video", policyBool(access.video)],
      ["Originals", policyBool(access.originals)],
    ];
  };

  const policyDecisionCard = (title, decision, emptyText = "") => {
    if (!decision) {
      return `
        <article class="acs-access-card acs-policy-card">
          <header>
            <strong>${escapeHtml(title)}</strong>
            <span class="acs-chip is-disabled">not tested</span>
          </header>
          <small>${escapeHtml(emptyText || "No selected person.")}</small>
        </article>
      `;
    }
    const reasons = Array.isArray(decision.reasons) ? decision.reasons : [];
    const scopes = Array.isArray(decision.matchingScopes) ? decision.matchingScopes : [];
    return `
      <article class="acs-access-card acs-policy-card">
        <header>
          <strong>${escapeHtml(title)}</strong>
          <span class="acs-chip ${decision.allowed ? "is-ok" : "is-blocked"}">${escapeHtml(decision.allowed ? "allowed" : "blocked")}</span>
        </header>
        <dl class="acs-policy-grid">
          ${policyRows(decision).map(([term, value]) => `
            <div>
              <dt>${escapeHtml(term)}</dt>
              <dd>${escapeHtml(value)}</dd>
            </div>
          `).join("")}
        </dl>
        ${reasons.length ? `<small>${escapeHtml(reasons.map(policyReasonLabel).join(", "))}</small>` : ""}
        ${scopes.length ? `<span class="acs-gallery-stack">${scopes.map((scope) => `<span class="acs-chip">${escapeHtml(scope.label || scope.galleryKey || scope.source)}</span>`).join("")}</span>` : ""}
      </article>
    `;
  };

  const renderPolicyResult = () => {
    if (policyTestButton) {
      const group = selectedGroup();
      policyTestButton.disabled = state.policyBusy || !group?.galleryKey;
    }
    if (!policyResultRoot) return;
    const body = state.policyResult;
    if (!body?.decisions) {
      policyResultRoot.innerHTML = "";
      return;
    }
    const selectedLabel = body.selectedUser?.email
      ? `Selected: ${body.selectedUser.email}`
      : "Selected person";
    policyResultRoot.innerHTML = `
      <div class="acs-policy-result-header">
        <strong>Worker policy</strong>
        <small>${escapeHtml(body.gallery?.label || body.gallery?.galleryKey || "")}</small>
      </div>
      <div class="acs-policy-result-grid">
        ${policyDecisionCard("Regular visitor", body.decisions.visitor)}
        ${policyDecisionCard(selectedLabel, body.decisions.selected, body.requestedEmail ? "No access person found." : "No selected person.")}
        ${policyDecisionCard("Owner/admin", body.decisions.owner)}
      </div>
    `;
  };

  const clearPolicyResult = () => {
    state.policyResult = null;
    if (policyStatusRoot) policyStatusRoot.textContent = "";
    renderPolicyResult();
  };

  const auditActionLabel = (event = {}) => {
    const value = event.summary || event.action || event.eventType || "Access change";
    return String(value)
      .replace(/_/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  };

  const auditTargetLabel = (event = {}) => {
    if (event.targetType === "person") return event.targetEmail || event.targetId || "";
    if (event.targetType === "group") return event.targetId || event.targetEmail || "";
    return event.targetId || event.targetEmail || "";
  };

  const auditDetailText = (event = {}) => [
    event.eventType || "",
    event.actorEmail ? `by ${event.actorEmail}` : "",
    event.createdAt || "",
  ].filter(Boolean).join(" / ");

  const renderAudit = () => {
    if (!auditRoot) return;
    if (!state.auditEvents.length) {
      auditRoot.innerHTML = `<li class="acs-empty">No audit events yet.</li>`;
      if (auditStatusRoot) auditStatusRoot.textContent = "No access changes recorded yet.";
      return;
    }
    if (auditStatusRoot && !state.undoBusy) {
      const reversibleCount = state.auditEvents.filter((event) => event.reversible && !event.revertedAt).length;
      auditStatusRoot.textContent = `${state.auditEvents.length} recent changes, ${reversibleCount} reversible.`;
    }
    auditRoot.innerHTML = state.auditEvents.map((event) => `
      <li class="${event.revertedAt ? "is-reverted" : ""}">
        <div class="acs-audit-main">
          <strong>${escapeHtml(auditActionLabel(event))}</strong>
          ${auditTargetLabel(event) ? `<code>${escapeHtml(auditTargetLabel(event))}</code>` : ""}
          <small>${escapeHtml(auditDetailText(event))}</small>
        </div>
        <div class="acs-audit-actions">
          ${event.revertedAt
            ? `<span class="acs-chip is-disabled">undone</span>`
            : (event.reversible
              ? `<button class="btn secondary" type="button" data-acs-undo-audit="${escapeHtml(event.id)}" ${state.undoBusy ? "disabled" : ""}>Undo</button>`
              : `<span class="acs-chip">logged</span>`)}
        </div>
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
    renderInvitation();
    fillGroupForm(selectedGroup());
    renderAccessPreview();
    renderPolicyResult();
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
      state.realEstateCredentials = Array.isArray(body.realEstateCredentials) ? body.realEstateCredentials : [];
      state.policyResult = null;
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
      state.realEstateCredentials = [];
      state.selectedGroupId = "";
      state.policyResult = null;
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
    const directGalleryKeys = [...new Set([
      ...checkedValues("[data-acs-gallery]", "acsGallery"),
      ...parseLines(realEstateInput?.value || ""),
    ])];
    const selectedGroupIds = checkedValues("[data-acs-group]", "acsGroup");
    const groupGalleryKeys = state.audienceGroups
      .filter((group) => selectedGroupIds.includes(group.id) && group.galleryKind === "real_estate" && group.state !== "archived")
      .map((group) => group.galleryKey)
      .filter(Boolean);
    const credentialGalleryKeys = [...new Set([...directGalleryKeys, ...groupGalleryKeys])];
    const existingCredentials = credentialsFor(selectedUser()?.email || emailInput?.value || "");
    const loginName = passwordLoginNameInput?.value || "";
    const password = passwordLoginPasswordInput?.value || "";
    const payload = {
      email: emailInput?.value || "",
      displayName: displayNameInput?.value || "",
      roles,
      realEstateClients: directGalleryKeys,
      groupIds: selectedGroupIds,
      notes: notesInput?.value || "",
      fixture: selectedUser()?.fixture === true,
      ...((loginName || password || existingCredentials.length) && credentialGalleryKeys.length ? {
        passwordLogin: {
          loginName: loginName || displayNameInput?.value || emailInput?.value || "",
          password,
          galleryKeys: credentialGalleryKeys,
        },
      } : {}),
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
      galleryDefaults: galleryDefaultsFromForm(),
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

  const undoAuditEvent = async (auditId) => {
    const event = state.auditEvents.find((item) => item.id === auditId);
    if (!event) {
      setStatus("Select an audit event before undoing.");
      return;
    }
    if (!event.reversible || event.revertedAt) {
      setStatus("That access change is not reversible.");
      return;
    }
    const label = auditActionLabel(event);
    const target = auditTargetLabel(event);
    if (!window.confirm?.(`Undo ${label}${target ? ` for ${target}` : ""}?`)) return;
    state.undoBusy = true;
    if (auditStatusRoot) auditStatusRoot.textContent = "Undoing access change...";
    renderAudit();
    try {
      await apiFetch(`/access-console/audit/${encodeURIComponent(auditId)}/undo`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setStatus("Access change undone.");
      await load();
    } finally {
      state.undoBusy = false;
      renderAudit();
    }
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

  const prepareEmailInvites = () => {
    const group = selectedGroup();
    if (!group?.id || group.state === "archived") {
      setStatus("Select an active group before preparing invitations.");
      return;
    }
    const recipients = parseMemberEntries(inviteEmailsInput?.value || "");
    if (!recipients.length) {
      setStatus("Enter at least one valid invitee email address.");
      return;
    }
    state.inviteOutput = {
      kind: "email",
      groupId: group.id,
      recipients,
    };
    setStatus(`Prepared ${recipients.length} email invite${recipients.length === 1 ? "" : "s"} for ${group.label || group.id}.`);
    renderInvitation();
  };

  const copyInviteLink = async () => {
    const group = selectedGroup();
    if (!group?.id || group.state === "archived") {
      setStatus("Select an active group before copying an invite link.");
      return;
    }
    const url = inviteUrlFor(group, "link");
    state.inviteOutput = { kind: "link", groupId: group.id };
    try {
      await navigator.clipboard?.writeText(url);
      setStatus(`Copied preview invite link for ${group.label || group.id}.`);
    } catch {
      setStatus("Preview invite link is ready; clipboard access was unavailable.");
    }
    renderInvitation();
  };

  const showInviteQrPayload = () => {
    const group = selectedGroup();
    if (!group?.id || group.state === "archived") {
      setStatus("Select an active group before preparing a QR payload.");
      return;
    }
    state.inviteOutput = { kind: "qr", groupId: group.id };
    setStatus(`Prepared QR payload for ${group.label || group.id}.`);
    renderInvitation();
  };

  const testSelectedPolicy = async () => {
    const group = selectedGroup();
    if (!group?.galleryKey) {
      setStatus("Select a group with a gallery key before testing policy.");
      return;
    }
    const user = selectedUser();
    const params = new URLSearchParams({
      galleryKind: group.galleryKind || group.kind || "event",
      galleryKey: group.galleryKey || group.id,
      ownerOriginals: state.ownerOriginals ? "1" : "0",
    });
    if (user?.email) params.set("email", user.email);
    state.policyResult = null;
    state.policyBusy = true;
    if (policyStatusRoot) policyStatusRoot.textContent = "Testing...";
    renderPolicyResult();
    try {
      const body = await apiFetch(`/access-console/gallery-access?${params.toString()}`);
      state.policyResult = body;
      if (policyStatusRoot) policyStatusRoot.textContent = `${body.gallery?.label || group.label || group.id} tested`;
      setStatus("Worker policy test complete.");
      renderPolicyResult();
    } finally {
      state.policyBusy = false;
      renderPolicyResult();
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

  peopleRoot?.addEventListener("click", (event) => {
    const row = event.target.closest("[data-acs-person]");
    if (!row) return;
    state.selectedEmail = row.dataset.acsPerson || "";
    clearPolicyResult();
    render();
  });

  groupListRoot?.addEventListener("click", (event) => {
    const row = event.target.closest("[data-acs-group-row]");
    if (!row) return;
    state.selectedGroupId = row.dataset.acsGroupRow || "";
    state.inviteOutput = null;
    clearPolicyResult();
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

  inviteForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    prepareEmailInvites();
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

  auditRoot?.addEventListener("click", (event) => {
    const undoButton = event.target.closest("[data-acs-undo-audit]");
    if (!undoButton) return;
    undoAuditEvent(undoButton.dataset.acsUndoAudit || "")
      .catch((error) => setStatus(error.message || "Could not undo access change."));
  });

  $("[data-acs-refresh]")?.addEventListener("click", () => load());
  peopleSearchInput?.addEventListener("input", () => {
    state.filters.search = peopleSearchInput.value || "";
    renderPeople();
  });
  filterGroupInput?.addEventListener("change", () => {
    state.filters.groupId = filterGroupInput.value || "";
    if (state.filters.groupId) state.selectedGroupId = state.filters.groupId;
    state.inviteOutput = null;
    clearPolicyResult();
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
    clearPolicyResult();
    fillForm(null);
    renderPeople();
    renderEffectiveAccess();
  });
  $("[data-acs-new-group]")?.addEventListener("click", () => {
    state.selectedGroupId = "";
    state.inviteOutput = null;
    clearPolicyResult();
    fillGroupForm(null);
    renderGroupList();
    renderInvitation();
  });
  groupIdInput?.addEventListener("input", () => {
    groupIdEdited = true;
  });
  groupGalleryKeyInput?.addEventListener("input", () => {
    groupGalleryKeyEdited = true;
  });
  groupGalleryRecordInput?.addEventListener("change", () => {
    const record = knownGalleryRecords().find((item) => galleryRecordKeyFor(item) === groupGalleryRecordInput.value);
    applyGalleryRecord(record);
    clearPolicyResult();
    renderAccessPreview();
  });
  document.querySelectorAll("[data-acs-gallery-default]").forEach((input) => {
    input.addEventListener("change", () => {
      syncCapabilitiesFromDefaults();
      clearPolicyResult();
      renderAccessPreview();
    });
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
  copyInviteLinkButton?.addEventListener("click", () => copyInviteLink());
  showInviteQrButton?.addEventListener("click", showInviteQrPayload);
  policyTestButton?.addEventListener("click", () => testSelectedPolicy().catch((error) => {
    if (policyStatusRoot) policyStatusRoot.textContent = "";
    setStatus(error.message || "Could not test policy.");
  }));
  accessPreviewInput?.addEventListener("change", () => {
    state.accessPreviewMode = accessPreviewInput.value || "group";
    renderAccessPreview();
  });
  ownerOriginalsInput?.addEventListener("change", () => {
    state.ownerOriginals = Boolean(ownerOriginalsInput.checked);
    clearPolicyResult();
    renderAccessPreview();
  });
  $("[data-acs-seed-fixtures]")?.addEventListener("click", () => seedFixtures().catch((error) => setStatus(error.message || "Could not seed fixtures.")));
  $("[data-acs-login]")?.addEventListener("click", login);
  $("[data-acs-logout]")?.addEventListener("click", logout);
  absorbAuthTokenFromHash();
  load();
})();
