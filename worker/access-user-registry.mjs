const SCHEMA = "photosbyelie.accessUser.v1";
const VALID_TIERS = new Set(["user", "re_client", "owner"]);
const VALID_GROUP_KINDS = new Set(["family", "event", "real_estate", "public", "custom"]);
const VALID_GALLERY_KINDS = new Set(["event", "real_estate", "public", "custom"]);
const GRANTABLE_ROLES = new Set(["owner", "re_client"]);
export const ACCESS_CAPABILITIES = [
  { id: "view_public", label: "View public galleries" },
  { id: "buy_downloads", label: "Buy downloads" },
  { id: "redownload_purchases_30d", label: "30-day purchase redownloads" },
  { id: "view_gallery", label: "View assigned gallery" },
  { id: "view_watermarked", label: "Watermarked previews" },
  { id: "download_items", label: "Download assigned items" },
  { id: "pdf", label: "PDF deliverables" },
  { id: "video", label: "Video deliverables" },
  { id: "view_originals", label: "Full-resolution originals" },
  { id: "view_all_galleries", label: "View all galleries" },
  { id: "manage_access", label: "Manage access" },
];
const ACCESS_CAPABILITY_IDS = new Set(ACCESS_CAPABILITIES.map((capability) => capability.id));
const BASE_USER_CAPABILITIES = ["view_public", "buy_downloads", "redownload_purchases_30d"];
const OWNER_CAPABILITIES = ["view_all_galleries", "view_originals", "manage_access"];
const DEFAULT_REAL_ESTATE_CAPABILITIES = ["view_gallery", "view_watermarked", "pdf", "video", "view_originals"];
const DEFAULT_GALLERY_DEFAULTS = {
  watermarked: true,
  saleEnabled: true,
  downloads: false,
  pdf: false,
  video: false,
  memberOriginals: false,
  ownerOriginals: false,
};
const LEGACY_FIXTURE_EVENT_IDS = [
  "fixture-family-direct-kin",
  "fixture-event-summer-portraits",
  "fixture-re-gallery",
];
const FIXTURE_GROUPS = [
  {
    id: "agnes-bday",
    label: "Agnes's B'day",
    kind: "family",
    galleryKind: "event",
    galleryKey: "agnes-bday",
    accessPolicy: "family-circle previews, watermarked by default, downloads through normal purchase/re-download rules",
    capabilities: ["view_gallery", "view_watermarked", "download_items"],
    galleryDefaults: {
      watermarked: true,
      saleEnabled: true,
      downloads: true,
      pdf: false,
      video: false,
      memberOriginals: false,
      ownerOriginals: true,
    },
  },
  {
    id: "re-la-concha",
    label: "RE La Concha",
    kind: "real_estate",
    galleryKind: "real_estate",
    galleryKey: "re-la-concha",
    accessPolicy: "assigned Real Estate gallery with PDF, video, and original-deliverable access",
    capabilities: DEFAULT_REAL_ESTATE_CAPABILITIES,
    galleryDefaults: {
      watermarked: true,
      saleEnabled: false,
      downloads: false,
      pdf: true,
      video: true,
      memberOriginals: true,
      ownerOriginals: true,
    },
  },
  {
    id: "johnson-palmer-wedding",
    label: "Johnson-Palmer wedding",
    kind: "event",
    galleryKind: "event",
    galleryKey: "johnson-palmer-wedding",
    accessPolicy: "event attendee previews with watermarks plus assigned item downloads",
    capabilities: ["view_gallery", "view_watermarked", "download_items"],
    galleryDefaults: {
      watermarked: true,
      saleEnabled: true,
      downloads: true,
      pdf: false,
      video: false,
      memberOriginals: false,
      ownerOriginals: true,
    },
  },
];
const FIXTURE_PEOPLE = [
  {
    email: "alex.rivera@example.test",
    displayName: "Alex Rivera / Agnes guest",
    tier: "user",
    groupIds: ["agnes-bday"],
    notes: "Fixture family-circle user for Agnes's B'day rehearsal.",
  },
  {
    email: "morgan.lee@example.test",
    displayName: "Morgan Lee / La Concha client",
    tier: "re_client",
    realEstateClients: ["re-la-concha"],
    groupIds: ["re-la-concha"],
    notes: "Fixture RE client tied to the RE La Concha gallery.",
  },
  {
    email: "sam.patel@example.test",
    displayName: "Sam Patel",
    tier: "owner",
    notes: "Fixture owner-style helper account for permission testing.",
  },
  {
    email: "jamie.martin@example.test",
    displayName: "Jamie Martin / Johnson-Palmer guest",
    tier: "user",
    groupIds: ["johnson-palmer-wedding"],
    notes: "Fixture event attendee for the Johnson-Palmer wedding.",
  },
  {
    email: "palmer.family@example.test",
    displayName: "Palmer Family",
    tier: "user",
    groupIds: ["johnson-palmer-wedding"],
    notes: "Second fixture event attendee for role/group assignment rehearsal.",
  },
];
const FIXTURE_EVENTS = FIXTURE_GROUPS.map(({ id, label, kind, accessPolicy }) => ({
  id,
  label,
  kind,
  accessPolicy,
}));

const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));

const nowIso = () => new Date().toISOString();

const randomId = (prefix) => `${prefix}-${crypto.randomUUID().replace(/[^a-z0-9]/gi, "").slice(0, 24)}`;

const normalizeTier = (value) => {
  const tier = String(value || "user").trim().toLowerCase().replace(/[-\s]+/g, "_");
  return VALID_TIERS.has(tier) ? tier : "user";
};

const normalizeGroupKind = (value, fallback = "event") => {
  const kind = String(value || fallback).trim().toLowerCase().replace(/[-\s]+/g, "_");
  return VALID_GROUP_KINDS.has(kind) ? kind : fallback;
};

const normalizeGalleryKind = (value, fallback = "event") => {
  const kind = String(value || fallback).trim().toLowerCase().replace(/[-\s]+/g, "_");
  return VALID_GALLERY_KINDS.has(kind) ? kind : fallback;
};

const normalizeGroupState = (value) => {
  const state = String(value || "active").trim().toLowerCase().replace(/[-\s]+/g, "_");
  return state === "archived" ? "archived" : "active";
};

const normalizeGalleryKeys = (value) => {
  const source = Array.isArray(value) ? value : String(value || "").split(/[\s,;]+/);
  return [...new Set(source.map((item) => String(item || "").trim()).filter(Boolean))];
};

const normalizeSlug = (value) => String(value || "")
  .trim()
  .toLowerCase()
  .replace(/['"]/g, "")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "");

const parseJsonArray = (value) => {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const parseJsonObject = (value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (value == null || value === "") return {};
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const normalizeCapabilities = (value) => {
  const source = Array.isArray(value) ? value : String(value || "").split(/[\s,;]+/);
  return [...new Set(source
    .map((item) => String(item || "").trim().toLowerCase().replace(/[-\s]+/g, "_"))
    .filter((item) => item && (ACCESS_CAPABILITY_IDS.has(item) || /^[a-z0-9_:]+$/.test(item))))];
};

const normalizeGalleryDefaults = (value = {}, capabilities = [], group = {}) => {
  const source = parseJsonObject(value);
  const caps = new Set(normalizeCapabilities(capabilities));
  const bool = (key, fallback) => source[key] === true || source[key] === 1 || source[key] === "1"
    ? true
    : (source[key] === false || source[key] === 0 || source[key] === "0" ? false : fallback);
  return {
    ...DEFAULT_GALLERY_DEFAULTS,
    watermarked: bool("watermarked", caps.has("view_watermarked")),
    saleEnabled: bool("saleEnabled", group.galleryKind !== "real_estate"),
    downloads: bool("downloads", caps.has("download_items")),
    pdf: bool("pdf", caps.has("pdf")),
    video: bool("video", caps.has("video")),
    memberOriginals: bool("memberOriginals", caps.has("view_originals")),
    ownerOriginals: bool("ownerOriginals", false),
  };
};

const normalizeGroupIds = (value) => {
  const source = Array.isArray(value) ? value : String(value || "").split(/[\s,;]+/);
  return [...new Set(source
    .map((item) => {
      if (item && typeof item === "object") return item.id || item.groupId || item.group_id || item.galleryKey;
      return item;
    })
    .map((item) => String(item || "").trim())
    .filter(Boolean))];
};

const normalizeAudienceGroup = (group = {}) => {
  const id = String(group.id || group.groupId || group.group_id || normalizeSlug(group.label || group.name)).trim();
  if (!id) return null;
  const galleryKey = String(group.galleryKey || group.gallery_key || id).trim();
  const capabilities = group.capabilities
    || group.capabilitiesJson
    || parseJsonArray(group.capabilities_json);
  const base = {
    kind: normalizeGroupKind(group.kind),
    galleryKind: normalizeGalleryKind(group.galleryKind || group.gallery_kind || group.kind),
  };
  return {
    id,
    label: String(group.label || group.name || id).trim(),
    kind: base.kind,
    galleryKind: base.galleryKind,
    galleryKey,
    accessPolicy: String(group.accessPolicy || group.access_policy || "").trim(),
    capabilities: normalizeCapabilities(capabilities),
    galleryDefaults: normalizeGalleryDefaults(
      group.galleryDefaults || group.gallery_defaults || group.galleryDefaultsJson || group.gallery_defaults_json,
      capabilities,
      base
    ),
    state: normalizeGroupState(group.state),
    archivedAt: group.archivedAt || group.archived_at || null,
    archivedBy: String(group.archivedBy || group.archived_by || "").trim(),
    fixture: group.fixture === true || group.fixture === 1 || group.fixture === "1",
  };
};

const fixtureGroups = () => FIXTURE_GROUPS
  .map((group) => normalizeAudienceGroup({ ...group, fixture: true }))
  .filter(Boolean);

const activeAudienceGroups = (groups = []) => groups
  .map(normalizeAudienceGroup)
  .filter(Boolean)
  .filter((group) => group.state !== "archived");

const galleryOptionsFor = (groups = []) => activeAudienceGroups(groups)
  .map((group) => ({
    id: group.id,
    label: group.label,
    kind: group.kind,
    galleryKind: group.galleryKind,
    galleryKey: group.galleryKey,
    accessPolicy: group.accessPolicy,
    capabilities: group.capabilities,
    galleryDefaults: group.galleryDefaults,
    fixture: group.fixture,
    source: "audience_group",
  }))
  .sort((left, right) => `${left.galleryKind}:${left.label}`.localeCompare(`${right.galleryKind}:${right.label}`));

const normalizeDisplayName = (value) => String(value || "").trim().replace(/\s+/g, " ").slice(0, 160);

const normalizeNotes = (value) => String(value || "").trim().slice(0, 2000);

const normalizeRoleList = (record = {}) => {
  const roles = new Set();
  const source = Array.isArray(record.roles)
    ? record.roles
    : String(record.roles || "").split(/[\s,;]+/);
  source
    .map((role) => String(role || "").trim().toLowerCase().replace(/[-\s]+/g, "_"))
    .filter((role) => GRANTABLE_ROLES.has(role))
    .forEach((role) => roles.add(role));
  const tier = normalizeTier(record.tier);
  if (GRANTABLE_ROLES.has(tier)) roles.add(tier);
  return [...roles];
};

const tierForRoles = (roles = [], realEstateClients = []) => {
  const roleSet = new Set(roles);
  if (roleSet.has("owner")) return "owner";
  if (roleSet.has("re_client") || realEstateClients.length) return "re_client";
  return "user";
};

const decorateAccessUserRecord = (record, groups = []) => {
  const normalized = normalizeAccessUserRecord(record);
  if (!normalized) return null;
  const normalizedGroups = activeAudienceGroups(groups);
  const groupsById = new Map(normalizedGroups.map((group) => [group.id, group]));
  const groupRecords = normalized.groupIds
    .map((groupId) => groupsById.get(groupId) || normalizeAudienceGroup({ id: groupId, label: groupId }))
    .filter(Boolean);
  const scopes = [];
  const capabilitySet = new Set();
  const addScope = (scope) => {
    const capabilities = normalizeCapabilities(scope.capabilities);
    capabilities.forEach((capability) => capabilitySet.add(capability));
    scopes.push({
      source: scope.source || "",
      label: scope.label || scope.galleryKey || scope.role || "",
      role: scope.role || "",
      groupId: scope.groupId || "",
      galleryKind: scope.galleryKind || "",
      galleryKey: scope.galleryKey || "",
      accessPolicy: scope.accessPolicy || "",
      capabilities,
      galleryDefaults: normalizeGalleryDefaults(scope.galleryDefaults || {}, capabilities, scope),
    });
  };

  addScope({
    source: "role",
    role: "user",
    label: "Regular user",
    galleryKind: "public",
    galleryKey: "public",
    accessPolicy: "public browsing, checkout, and 30-day purchased-download recovery",
    capabilities: BASE_USER_CAPABILITIES,
  });

  if (normalized.roles.includes("owner")) {
    addScope({
      source: "role",
      role: "owner",
      label: "Owner role",
      galleryKind: "owner",
      galleryKey: "all",
      accessPolicy: "owner workflow access, full-gallery inspection, and access assignment",
      capabilities: OWNER_CAPABILITIES,
    });
  }

  for (const group of groupRecords) {
    addScope({
      source: "group",
      groupId: group.id,
      label: group.label,
      galleryKind: group.galleryKind,
      galleryKey: group.galleryKey,
      accessPolicy: group.accessPolicy,
      capabilities: group.capabilities,
      galleryDefaults: group.galleryDefaults,
    });
  }

  const groupRealEstateKeys = new Set(groupRecords
    .filter((group) => group.galleryKind === "real_estate")
    .map((group) => group.galleryKey)
    .filter(Boolean));
  for (const galleryKey of normalized.realEstateClients) {
    if (groupRealEstateKeys.has(galleryKey)) continue;
    const group = normalizedGroups.find((item) => item.galleryKind === "real_estate" && item.galleryKey === galleryKey);
    addScope({
      source: "direct_grant",
      label: group?.label || galleryKey,
      galleryKind: "real_estate",
      galleryKey,
      accessPolicy: group?.accessPolicy || "direct Real Estate gallery grant",
      capabilities: group?.capabilities?.length ? group.capabilities : DEFAULT_REAL_ESTATE_CAPABILITIES,
      galleryDefaults: group?.galleryDefaults || {},
    });
  }

  const gallerySummary = scopes
    .filter((scope) => scope.galleryKind && scope.galleryKind !== "public")
    .map((scope) => scope.label)
    .filter(Boolean);

  return {
    ...normalized,
    groups: groupRecords,
    effectiveAccess: {
      summary: normalized.disabledAt ? "Disabled; public-only if signed in" : (gallerySummary.join(", ") || "Public galleries and account recovery"),
      scopes,
      capabilities: [...capabilitySet].sort(),
    },
  };
};

export const normalizeAccessUserRecord = (record = {}, fallbackEmail = "") => {
  const email = normalizeEmail(record.email || fallbackEmail);
  if (!validEmail(email)) return null;
  const grantableRoles = normalizeRoleList(record);
  const realEstateClients = normalizeGalleryKeys(
    record.realEstateClients || record.realEstateGalleries || record.galleryKeys || record.galleryKey
  );
  const disabledAt = record.disabledAt || record.disabled_at || null;
  const groupIds = normalizeGroupIds(record.groupIds || record.group_ids || record.audienceGroups || record.groups);
  return {
    schema: SCHEMA,
    email,
    displayName: normalizeDisplayName(record.displayName || record.display_name || record.name),
    tier: disabledAt ? "user" : tierForRoles(grantableRoles, realEstateClients),
    roles: disabledAt ? ["user"] : ["user", ...grantableRoles],
    realEstateClients: disabledAt ? [] : realEstateClients,
    groupIds: disabledAt ? [] : groupIds,
    notes: normalizeNotes(record.notes),
    source: String(record.source || "").trim() || (record.fixture ? "fixture" : "manual"),
    fixture: record.fixture === true || record.fixture === 1 || record.fixture === "1",
    disabledAt,
    disabledBy: String(record.disabledBy || record.disabled_by || "").trim(),
    grantedBy: String(record.grantedBy || record.granted_by || "").trim(),
    grantedAt: record.grantedAt || record.granted_at || null,
    updatedAt: record.updatedAt || record.updated_at || null,
  };
};

const fixtureEvents = () => FIXTURE_EVENTS.map((event) => ({ ...event, fixture: true }));

export const createMemoryAccessUserRegistry = (initialRecords = []) => {
  const users = new Map();
  const auditEvents = [];
  const events = new Map();
  const groups = new Map();
  initialRecords
    .map((record) => normalizeAccessUserRecord(record))
    .filter(Boolean)
    .forEach((record) => users.set(record.email, record));

  const listAudienceGroups = async () => [...groups.values()]
    .map((group) => normalizeAudienceGroup(group))
    .filter(Boolean)
    .sort((left, right) => `${left.state === "archived" ? 1 : 0}:${left.kind}:${left.label}`
      .localeCompare(`${right.state === "archived" ? 1 : 0}:${right.kind}:${right.label}`));

  const listActiveAudienceGroups = async () => activeAudienceGroups(await listAudienceGroups());

  const decorate = async (record) => decorateAccessUserRecord(record, await listActiveAudienceGroups());

  const audit = (eventType, actorEmail, targetEmail, before, after) => {
    const event = {
      id: randomId("access-audit"),
      eventType,
      actorEmail: normalizeEmail(actorEmail),
      targetEmail: normalizeEmail(targetEmail),
      before,
      after,
      createdAt: nowIso(),
    };
    auditEvents.unshift(event);
    return clone(event);
  };

  const getUser = async (email) => {
    const record = users.get(normalizeEmail(email));
    return record ? clone(await decorate(record)) : null;
  };

  const listUsers = async () => [...users.values()]
    .map((record) => decorateAccessUserRecord(record, activeAudienceGroups([...groups.values()])))
    .filter(Boolean)
    .sort((left, right) => String(left.email).localeCompare(String(right.email)));

  const putUser = async (record, options = {}) => {
    const normalized = normalizeAccessUserRecord(record);
    if (!normalized) throw new Error("Access user record requires a valid email address.");
    const before = await getUser(normalized.email);
    const timestamp = nowIso();
    const activeGroupIds = new Set((await listActiveAudienceGroups()).map((group) => group.id));
    const after = {
      ...normalized,
      groupIds: normalized.groupIds.filter((groupId) => activeGroupIds.has(groupId)),
      grantedBy: normalized.grantedBy || options.actorEmail || "",
      grantedAt: normalized.grantedAt || timestamp,
      updatedAt: timestamp,
    };
    users.set(after.email, clone(after));
    audit("user_upserted", options.actorEmail || after.grantedBy || "", after.email, before, after);
    return clone(await decorate(after));
  };

  const getAudienceGroup = async (groupId) => {
    const group = groups.get(String(groupId || "").trim());
    return group ? clone(normalizeAudienceGroup(group)) : null;
  };

  const putAudienceGroup = async (group, options = {}) => {
    const normalized = normalizeAudienceGroup({
      ...group,
      state: "active",
      archivedAt: null,
      archivedBy: "",
    });
    if (!normalized?.label) throw new Error("Audience group requires a label.");
    if (!normalized.galleryKey) throw new Error("Audience group requires a gallery key.");
    const before = await getAudienceGroup(normalized.id);
    const timestamp = nowIso();
    const after = {
      ...normalized,
      fixture: normalized.fixture || before?.fixture === true,
      createdAt: before?.createdAt || timestamp,
      createdBy: before?.createdBy || options.actorEmail || "",
      updatedAt: timestamp,
      updatedBy: options.actorEmail || "",
    };
    groups.set(after.id, clone(after));
    audit("group_upserted", options.actorEmail || "", after.id, before, after);
    return clone(after);
  };

  const archiveAudienceGroup = async (groupId, options = {}) => {
    const before = await getAudienceGroup(groupId);
    if (!before) return null;
    const timestamp = nowIso();
    const after = {
      ...before,
      state: "archived",
      archivedAt: timestamp,
      archivedBy: options.actorEmail || "",
      updatedAt: timestamp,
      updatedBy: options.actorEmail || "",
    };
    groups.set(after.id, clone(after));
    for (const [email, record] of users.entries()) {
      if (!record.groupIds?.includes(after.id)) continue;
      users.set(email, {
        ...record,
        groupIds: record.groupIds.filter((id) => id !== after.id),
        updatedAt: timestamp,
      });
    }
    audit("group_archived", options.actorEmail || "", after.id, before, after);
    return clone(after);
  };

  const disableUser = async (email, options = {}) => {
    const normalizedEmail = normalizeEmail(email);
    const before = await getUser(normalizedEmail);
    if (!before) return null;
    const after = normalizeAccessUserRecord({
      ...before,
      disabledAt: nowIso(),
      disabledBy: options.actorEmail || "",
      updatedAt: nowIso(),
    });
    users.set(normalizedEmail, clone(after));
    audit("user_disabled", options.actorEmail || "", normalizedEmail, before, after);
    return clone(await decorate(after));
  };

  const seedFixtureData = async (options = {}) => {
    events.clear();
    groups.clear();
    for (const group of fixtureGroups()) {
      groups.set(group.id, group);
    }
    for (const person of FIXTURE_PEOPLE) {
      await putUser({ ...person, fixture: true, source: "fixture" }, options);
    }
    for (const event of FIXTURE_EVENTS) {
      events.set(event.id, { ...event, fixture: true });
    }
    return {
      users: (await listUsers()).filter((user) => user.fixture),
      events: await listFixtureEvents(),
      groups: await listAudienceGroups(),
    };
  };

  const listFixtureEvents = async () => [...events.values()].length
    ? [...events.values()].map(clone)
    : fixtureEvents();

  return {
    getUser,
    listUsers,
    putUser,
    disableUser,
    putAudienceGroup,
    archiveAudienceGroup,
    seedFixtureData,
    listFixtureEvents,
    listAudienceGroups,
    listGalleryOptions: async () => galleryOptionsFor(await listAudienceGroups()),
    listCapabilities: async () => ACCESS_CAPABILITIES.map(clone),
    listAuditEvents: async (limit = 25) => auditEvents.slice(0, limit).map(clone),
    _debug: { users, events, groups, auditEvents },
  };
};

export const createKvAccessUserRegistry = ({
  namespace,
  prefix = "pbe",
} = {}) => {
  if (!namespace) throw new Error("createKvAccessUserRegistry requires a KV namespace binding.");
  const keyFor = (email) => `${prefix}:access-users:${normalizeEmail(email)}`;

  const getUser = async (email) => {
    const normalizedEmail = normalizeEmail(email);
    if (!validEmail(normalizedEmail)) return null;
    const value = await namespace.get(keyFor(normalizedEmail), { type: "json" });
    return value ? decorateAccessUserRecord(value, fixtureGroups()) : null;
  };

  const putUser = async (record, options = {}) => {
    const normalized = normalizeAccessUserRecord({
      ...record,
      grantedBy: record.grantedBy || options.actorEmail || "",
      grantedAt: record.grantedAt || nowIso(),
      updatedAt: nowIso(),
    });
    if (!normalized) throw new Error("Access user record requires a valid email address.");
    await namespace.put(keyFor(normalized.email), JSON.stringify(normalized));
    return clone(decorateAccessUserRecord(normalized, fixtureGroups()));
  };

  const listUsers = async () => {
    if (typeof namespace.list !== "function") return [];
    const users = [];
    let cursor = "";
    do {
      const page = await namespace.list({ prefix: `${prefix}:access-users:`, limit: 1000, cursor });
      for (const key of page.keys || []) {
        const email = String(key.name || "").slice(`${prefix}:access-users:`.length);
        const user = await getUser(email);
        if (user) users.push(user);
      }
      cursor = page.list_complete ? "" : page.cursor || "";
    } while (cursor);
    return users.sort((left, right) => left.email.localeCompare(right.email));
  };

  return {
    getUser,
    putUser,
    listUsers,
    disableUser: async (email, options = {}) => {
      const existing = await getUser(email);
      if (!existing) return null;
      return putUser({
        ...existing,
        disabledAt: nowIso(),
        disabledBy: options.actorEmail || "",
      }, options);
    },
    seedFixtureData: async (options = {}) => {
      for (const person of FIXTURE_PEOPLE) {
        await putUser({ ...person, fixture: true, source: "fixture" }, options);
      }
      return {
        users: await listUsers(),
        events: fixtureEvents(),
        groups: fixtureGroups(),
      };
    },
    listFixtureEvents: async () => fixtureEvents(),
    listAudienceGroups: async () => fixtureGroups(),
    listGalleryOptions: async () => galleryOptionsFor(fixtureGroups()),
    listCapabilities: async () => ACCESS_CAPABILITIES.map(clone),
    listAuditEvents: async () => [],
  };
};

const d1All = async (statement) => {
  const result = await statement.all();
  return Array.isArray(result?.results) ? result.results : [];
};

const d1First = async (statement) => {
  if (typeof statement.first === "function") return statement.first();
  const rows = await d1All(statement);
  return rows[0] || null;
};

const d1Run = async (statement) => statement.run();

const roleRowsFor = async (database, email = "") => d1All(
  database.prepare("SELECT role FROM pbe_access_role_grants WHERE email = ? AND state = 'active' ORDER BY role").bind(email)
);

const galleryRowsFor = async (database, email = "") => d1All(
  database.prepare("SELECT gallery_key FROM pbe_access_gallery_grants WHERE email = ? AND gallery_kind = 'real_estate' AND state = 'active' ORDER BY gallery_key").bind(email)
);

const audienceGroupRows = async (database, { includeArchived = true } = {}) => d1All(database.prepare(`
  SELECT
    id,
    label,
    kind,
    gallery_kind AS galleryKind,
    gallery_key AS galleryKey,
    access_policy AS accessPolicy,
    capabilities_json AS capabilities_json,
    gallery_defaults_json AS galleryDefaultsJson,
    state,
    archived_at AS archivedAt,
    archived_by AS archivedBy,
    created_at AS createdAt,
    created_by AS createdBy,
    updated_at AS updatedAt,
    updated_by AS updatedBy,
    fixture
  FROM pbe_access_audience_groups
  ${includeArchived ? "" : "WHERE COALESCE(state, 'active') = 'active'"}
  ORDER BY CASE WHEN COALESCE(state, 'active') = 'archived' THEN 1 ELSE 0 END, kind, label
`));

const membershipRowsFor = async (database, email = "") => d1All(
  database.prepare(`
    SELECT
      g.id,
      g.label,
      g.kind,
      g.gallery_kind AS galleryKind,
      g.gallery_key AS galleryKey,
      g.access_policy AS accessPolicy,
      g.capabilities_json AS capabilities_json,
      g.gallery_defaults_json AS galleryDefaultsJson,
      g.state,
      g.archived_at AS archivedAt,
      g.archived_by AS archivedBy,
      g.fixture
    FROM pbe_access_group_memberships AS m
    JOIN pbe_access_audience_groups AS g ON g.id = m.group_id
    WHERE m.email = ? AND m.state = 'active' AND COALESCE(g.state, 'active') = 'active'
    ORDER BY g.kind, g.label
  `).bind(email)
);

const activeMembershipIdsFor = async (database, email = "") => d1All(
  database.prepare(`
    SELECT group_id AS groupId
    FROM pbe_access_group_memberships
    WHERE email = ? AND state = 'active'
    ORDER BY group_id
  `).bind(email)
);

const recordFromD1Rows = (person, roleRows = [], galleryRows = [], groupRows = [], allGroups = []) => {
  if (!person) return null;
  return decorateAccessUserRecord({
    email: person.email,
    displayName: person.display_name,
    roles: roleRows.map((row) => row.role),
    realEstateClients: galleryRows.map((row) => row.gallery_key),
    groupIds: groupRows.map((row) => row.id || row.groupId || row.group_id).filter(Boolean),
    notes: person.notes,
    source: person.source,
    fixture: person.fixture,
    disabledAt: person.disabled_at,
    disabledBy: person.disabled_by,
    grantedBy: person.created_by,
    grantedAt: person.created_at,
    updatedAt: person.updated_at,
  }, allGroups.length ? allGroups : groupRows);
};

const auditD1 = async (database, { eventType, actorEmail, targetEmail, before, after }) => d1Run(
  database.prepare(`
    INSERT INTO pbe_access_audit_events (
      id, event_type, actor_email, target_email, before_json, after_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    randomId("access-audit"),
    String(eventType || "access_change"),
    normalizeEmail(actorEmail),
    normalizeEmail(targetEmail),
    JSON.stringify(before || null),
    JSON.stringify(after || null),
    nowIso()
  )
);

export const createD1AccessUserRegistry = ({
  database,
} = {}) => {
  if (!database) throw new Error("createD1AccessUserRegistry requires a D1 database binding.");

  const getPerson = async (email) => d1First(
    database.prepare("SELECT * FROM pbe_access_people WHERE email = ?").bind(normalizeEmail(email))
  );

  const getUser = async (email) => {
    const normalizedEmail = normalizeEmail(email);
    if (!validEmail(normalizedEmail)) return null;
    const person = await getPerson(normalizedEmail);
    if (!person) return null;
    const [roles, galleries, memberGroups, allGroups] = await Promise.all([
      roleRowsFor(database, normalizedEmail),
      galleryRowsFor(database, normalizedEmail),
      membershipRowsFor(database, normalizedEmail),
      audienceGroupRows(database, { includeArchived: false }),
    ]);
    return recordFromD1Rows(person, roles, galleries, memberGroups, allGroups);
  };

  const putUser = async (record, options = {}) => {
    const normalized = normalizeAccessUserRecord(record);
    if (!normalized) throw new Error("Access user record requires a valid email address.");
    const before = await getUser(normalized.email);
    const actorEmail = normalizeEmail(options.actorEmail || normalized.grantedBy || "");
    const timestamp = nowIso();
    await d1Run(database.prepare(`
      INSERT INTO pbe_access_people (
        email, display_name, source, fixture, notes, disabled_at, disabled_by,
        created_at, created_by, updated_at, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        display_name = excluded.display_name,
        source = excluded.source,
        fixture = excluded.fixture,
        notes = excluded.notes,
        disabled_at = excluded.disabled_at,
        disabled_by = excluded.disabled_by,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by
    `).bind(
      normalized.email,
      normalized.displayName,
      normalized.source || "manual",
      normalized.fixture ? 1 : 0,
      normalized.notes,
      normalized.disabledAt,
      normalized.disabledBy,
      timestamp,
      actorEmail,
      timestamp,
      actorEmail
    ));

    const roles = new Set(normalizeRoleList(normalized));
    for (const role of GRANTABLE_ROLES) {
      if (roles.has(role)) {
        await d1Run(database.prepare(`
          INSERT INTO pbe_access_role_grants (
            id, email, role, state, granted_at, granted_by, updated_at, updated_by
          ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?)
          ON CONFLICT(email, role) DO UPDATE SET
            state = 'active',
            revoked_at = NULL,
            revoked_by = '',
            updated_at = excluded.updated_at,
            updated_by = excluded.updated_by
        `).bind(randomId("role-grant"), normalized.email, role, timestamp, actorEmail, timestamp, actorEmail));
      } else {
        await d1Run(database.prepare(`
          UPDATE pbe_access_role_grants
          SET state = 'revoked', revoked_at = ?, revoked_by = ?, updated_at = ?, updated_by = ?
          WHERE email = ? AND role = ? AND state = 'active'
        `).bind(timestamp, actorEmail, timestamp, actorEmail, normalized.email, role));
      }
    }

    const wantedGalleries = new Set(normalized.realEstateClients);
    const existingGalleries = await galleryRowsFor(database, normalized.email);
    for (const row of existingGalleries) {
      if (!wantedGalleries.has(row.gallery_key)) {
        await d1Run(database.prepare(`
          UPDATE pbe_access_gallery_grants
          SET state = 'revoked', revoked_at = ?, revoked_by = ?, updated_at = ?, updated_by = ?
          WHERE email = ? AND gallery_kind = 'real_estate' AND gallery_key = ? AND state = 'active'
        `).bind(timestamp, actorEmail, timestamp, actorEmail, normalized.email, row.gallery_key));
      }
    }
    for (const galleryKey of wantedGalleries) {
      await d1Run(database.prepare(`
        INSERT INTO pbe_access_gallery_grants (
          id, email, gallery_kind, gallery_key, state, granted_at, granted_by, updated_at, updated_by
        ) VALUES (?, ?, 'real_estate', ?, 'active', ?, ?, ?, ?)
        ON CONFLICT(email, gallery_kind, gallery_key) DO UPDATE SET
          state = 'active',
          revoked_at = NULL,
          revoked_by = '',
          updated_at = excluded.updated_at,
          updated_by = excluded.updated_by
      `).bind(randomId("gallery-grant"), normalized.email, galleryKey, timestamp, actorEmail, timestamp, actorEmail));
    }

    const knownGroups = await audienceGroupRows(database, { includeArchived: false });
    const knownGroupIds = new Set(knownGroups.map((group) => group.id));
    const wantedGroupIds = new Set(normalized.groupIds.filter((groupId) => knownGroupIds.has(groupId)));
    const existingMemberships = await activeMembershipIdsFor(database, normalized.email);
    for (const row of existingMemberships) {
      if (!wantedGroupIds.has(row.groupId)) {
        await d1Run(database.prepare(`
          UPDATE pbe_access_group_memberships
          SET state = 'revoked', revoked_at = ?, revoked_by = ?, updated_at = ?, updated_by = ?
          WHERE email = ? AND group_id = ? AND state = 'active'
        `).bind(timestamp, actorEmail, timestamp, actorEmail, normalized.email, row.groupId));
      }
    }
    for (const groupId of wantedGroupIds) {
      await d1Run(database.prepare(`
        INSERT INTO pbe_access_group_memberships (
          id, email, group_id, state, granted_at, granted_by, updated_at, updated_by
        ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?)
        ON CONFLICT(email, group_id) DO UPDATE SET
          state = 'active',
          revoked_at = NULL,
          revoked_by = '',
          updated_at = excluded.updated_at,
          updated_by = excluded.updated_by
      `).bind(randomId("group-member"), normalized.email, groupId, timestamp, actorEmail, timestamp, actorEmail));
    }

    const after = await getUser(normalized.email);
    await auditD1(database, { eventType: "user_upserted", actorEmail, targetEmail: normalized.email, before, after });
    return after;
  };

  const listUsers = async () => {
    const people = await d1All(database.prepare("SELECT * FROM pbe_access_people ORDER BY fixture DESC, email ASC"));
    const allGroups = await audienceGroupRows(database, { includeArchived: false });
    const users = [];
    for (const person of people) {
      const [roles, galleries, memberGroups] = await Promise.all([
        roleRowsFor(database, person.email),
        galleryRowsFor(database, person.email),
        membershipRowsFor(database, person.email),
      ]);
      const record = recordFromD1Rows(person, roles, galleries, memberGroups, allGroups);
      if (record) users.push(record);
    }
    return users;
  };

  const disableUser = async (email, options = {}) => {
    const normalizedEmail = normalizeEmail(email);
    const before = await getUser(normalizedEmail);
    if (!before) return null;
    const actorEmail = normalizeEmail(options.actorEmail || "");
    const timestamp = nowIso();
    await d1Run(database.prepare(`
      UPDATE pbe_access_people
      SET disabled_at = ?, disabled_by = ?, updated_at = ?, updated_by = ?
      WHERE email = ?
    `).bind(timestamp, actorEmail, timestamp, actorEmail, normalizedEmail));
    await d1Run(database.prepare(`
      UPDATE pbe_access_role_grants
      SET state = 'revoked', revoked_at = ?, revoked_by = ?, updated_at = ?, updated_by = ?
      WHERE email = ? AND state = 'active'
    `).bind(timestamp, actorEmail, timestamp, actorEmail, normalizedEmail));
    await d1Run(database.prepare(`
      UPDATE pbe_access_gallery_grants
      SET state = 'revoked', revoked_at = ?, revoked_by = ?, updated_at = ?, updated_by = ?
      WHERE email = ? AND state = 'active'
    `).bind(timestamp, actorEmail, timestamp, actorEmail, normalizedEmail));
    await d1Run(database.prepare(`
      UPDATE pbe_access_group_memberships
      SET state = 'revoked', revoked_at = ?, revoked_by = ?, updated_at = ?, updated_by = ?
      WHERE email = ? AND state = 'active'
    `).bind(timestamp, actorEmail, timestamp, actorEmail, normalizedEmail));
    const after = await getUser(normalizedEmail);
    await auditD1(database, { eventType: "user_disabled", actorEmail, targetEmail: normalizedEmail, before, after });
    return after;
  };

  const getAudienceGroup = async (groupId, { includeArchived = true } = {}) => d1First(
    database.prepare(`
      SELECT
        id,
        label,
        kind,
        gallery_kind AS galleryKind,
        gallery_key AS galleryKey,
        access_policy AS accessPolicy,
        capabilities_json AS capabilities_json,
        gallery_defaults_json AS galleryDefaultsJson,
        state,
        archived_at AS archivedAt,
        archived_by AS archivedBy,
        created_at AS createdAt,
        created_by AS createdBy,
        updated_at AS updatedAt,
        updated_by AS updatedBy,
        fixture
      FROM pbe_access_audience_groups
      WHERE id = ? ${includeArchived ? "" : "AND COALESCE(state, 'active') = 'active'"}
    `).bind(String(groupId || "").trim())
  ).then((row) => row ? normalizeAudienceGroup(row) : null);

  const putAudienceGroup = async (group, options = {}) => {
    const normalized = normalizeAudienceGroup({
      ...group,
      state: "active",
      archivedAt: null,
      archivedBy: "",
    });
    if (!normalized?.label) throw new Error("Audience group requires a label.");
    if (!normalized.galleryKey) throw new Error("Audience group requires a gallery key.");
    const before = await getAudienceGroup(normalized.id);
    const actorEmail = normalizeEmail(options.actorEmail || "");
    const timestamp = nowIso();
    await d1Run(database.prepare(`
      INSERT INTO pbe_access_audience_groups (
        id, label, kind, gallery_kind, gallery_key, access_policy, capabilities_json, gallery_defaults_json,
        state, archived_at, archived_by, fixture, created_at, created_by, updated_at, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, '', ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        label = excluded.label,
        kind = excluded.kind,
        gallery_kind = excluded.gallery_kind,
        gallery_key = excluded.gallery_key,
        access_policy = excluded.access_policy,
        capabilities_json = excluded.capabilities_json,
        gallery_defaults_json = excluded.gallery_defaults_json,
        state = 'active',
        archived_at = NULL,
        archived_by = '',
        fixture = CASE WHEN pbe_access_audience_groups.fixture = 1 THEN 1 ELSE excluded.fixture END,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by
    `).bind(
      normalized.id,
      normalized.label,
      normalized.kind,
      normalized.galleryKind,
      normalized.galleryKey,
      normalized.accessPolicy,
      JSON.stringify(normalized.capabilities),
      JSON.stringify(normalized.galleryDefaults),
      normalized.fixture || before?.fixture ? 1 : 0,
      timestamp,
      actorEmail,
      timestamp,
      actorEmail
    ));
    const after = await getAudienceGroup(normalized.id);
    await auditD1(database, { eventType: "group_upserted", actorEmail, targetEmail: normalized.id, before, after });
    return after;
  };

  const archiveAudienceGroup = async (groupId, options = {}) => {
    const normalizedGroupId = String(groupId || "").trim();
    const before = await getAudienceGroup(normalizedGroupId);
    if (!before) return null;
    const actorEmail = normalizeEmail(options.actorEmail || "");
    const timestamp = nowIso();
    await d1Run(database.prepare(`
      UPDATE pbe_access_audience_groups
      SET state = 'archived',
          archived_at = ?,
          archived_by = ?,
          updated_at = ?,
          updated_by = ?
      WHERE id = ?
    `).bind(timestamp, actorEmail, timestamp, actorEmail, normalizedGroupId));
    await d1Run(database.prepare(`
      UPDATE pbe_access_group_memberships
      SET state = 'revoked',
          revoked_at = ?,
          revoked_by = ?,
          updated_at = ?,
          updated_by = ?
      WHERE group_id = ? AND state = 'active'
    `).bind(timestamp, actorEmail, timestamp, actorEmail, normalizedGroupId));
    const after = await getAudienceGroup(normalizedGroupId);
    await auditD1(database, { eventType: "group_archived", actorEmail, targetEmail: normalizedGroupId, before, after });
    return after;
  };

  const listAudienceGroups = async () => audienceGroupRows(database)
    .then((rows) => rows.map(normalizeAudienceGroup).filter(Boolean));

  const listGalleryOptions = async () => galleryOptionsFor(await audienceGroupRows(database, { includeArchived: false }));

  const seedFixtureData = async (options = {}) => {
    const timestamp = nowIso();
    const actorEmail = normalizeEmail(options.actorEmail || "");
    for (const oldId of LEGACY_FIXTURE_EVENT_IDS) {
      await d1Run(database.prepare("DELETE FROM pbe_access_fixture_events WHERE id = ? AND fixture = 1").bind(oldId));
    }
    for (const group of fixtureGroups()) {
      await d1Run(database.prepare(`
        INSERT INTO pbe_access_audience_groups (
          id, label, kind, gallery_kind, gallery_key, access_policy, capabilities_json, gallery_defaults_json,
          state, archived_at, archived_by, fixture, created_at, created_by, updated_at, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, '', 1, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          label = excluded.label,
          kind = excluded.kind,
          gallery_kind = excluded.gallery_kind,
          gallery_key = excluded.gallery_key,
          access_policy = excluded.access_policy,
          capabilities_json = excluded.capabilities_json,
          gallery_defaults_json = excluded.gallery_defaults_json,
          state = 'active',
          archived_at = NULL,
          archived_by = '',
          fixture = 1,
          updated_at = excluded.updated_at,
          updated_by = excluded.updated_by
      `).bind(
        group.id,
        group.label,
        group.kind,
        group.galleryKind,
        group.galleryKey,
        group.accessPolicy,
        JSON.stringify(group.capabilities),
        JSON.stringify(group.galleryDefaults),
        timestamp,
        actorEmail,
        timestamp,
        actorEmail
      ));
    }
    for (const person of FIXTURE_PEOPLE) {
      await putUser({ ...person, fixture: true, source: "fixture" }, options);
    }
    for (const event of FIXTURE_EVENTS) {
      await d1Run(database.prepare(`
        INSERT INTO pbe_access_fixture_events (
          id, label, kind, access_policy, fixture, created_at, created_by, updated_at, updated_by
        ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          label = excluded.label,
          kind = excluded.kind,
          access_policy = excluded.access_policy,
          updated_at = excluded.updated_at,
          updated_by = excluded.updated_by
      `).bind(event.id, event.label, event.kind, event.accessPolicy, timestamp, actorEmail, timestamp, actorEmail));
    }
    return {
      users: (await listUsers()).filter((user) => user.fixture),
      events: await listFixtureEvents(),
      groups: await listAudienceGroups(),
    };
  };

  const listFixtureEvents = async () => d1All(database.prepare(`
    SELECT id, label, kind, access_policy AS accessPolicy, fixture
    FROM pbe_access_fixture_events
    ORDER BY kind, label
  `));

  const listAuditEvents = async (limit = 25) => d1All(database.prepare(`
    SELECT
      id,
      event_type AS eventType,
      actor_email AS actorEmail,
      target_email AS targetEmail,
      before_json AS beforeJson,
      after_json AS afterJson,
      created_at AS createdAt
    FROM pbe_access_audit_events
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(Math.max(1, Math.min(100, Number(limit) || 25))));

  return {
    getUser,
    putUser,
    listUsers,
    disableUser,
    putAudienceGroup,
    archiveAudienceGroup,
    seedFixtureData,
    listFixtureEvents,
    listAudienceGroups,
    listGalleryOptions,
    listCapabilities: async () => ACCESS_CAPABILITIES.map(clone),
    listAuditEvents,
  };
};
