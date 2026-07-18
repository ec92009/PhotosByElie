import {
  REAL_ESTATE_PASSWORD_ITERATIONS,
  realEstatePasswordHash,
} from "./real-estate-auth.mjs";
import { canonicalRealEstateGalleryKey } from "./real-estate-gallery-key.mjs";

export { canonicalRealEstateGalleryKey } from "./real-estate-gallery-key.mjs";

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
    galleryKey: "corine-real-estate",
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
    realEstateClients: ["corine-real-estate"],
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

const randomSecret = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const normalizeLogin = (value) => String(value || "").trim().toLowerCase();

const timingSafeStringEqual = (left, right) => {
  const a = String(left || "");
  const b = String(right || "");
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return diff === 0;
};

const publicRealEstateCredential = (record = {}) => ({
  email: normalizeEmail(record.email),
  loginName: String(record.loginName || record.login_name || "").trim(),
  galleryKey: String(record.galleryKey || record.gallery_key || "").trim(),
  state: String(record.state || "active"),
  passwordSet: Boolean(record.passwordHash || record.password_hash),
  createdAt: record.createdAt || record.created_at || "",
  updatedAt: record.updatedAt || record.updated_at || "",
  updatedBy: record.updatedBy || record.updated_by || "",
});

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
  return [...new Set(source.map(canonicalRealEstateGalleryKey).filter(Boolean))];
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
  const galleryKind = normalizeGalleryKind(group.galleryKind || group.gallery_kind || group.kind);
  const galleryKey = galleryKind === "real_estate"
    ? canonicalRealEstateGalleryKey(group.galleryKey || group.gallery_key || id)
    : String(group.galleryKey || group.gallery_key || id).trim();
  const capabilities = group.capabilities
    || group.capabilitiesJson
    || parseJsonArray(group.capabilities_json);
  const base = {
    kind: normalizeGroupKind(group.kind),
    galleryKind,
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

const UNDOABLE_AUDIT_TYPES = new Set(["user_upserted", "user_disabled", "group_upserted", "group_archived"]);

const parseAuditJsonValue = (value) => {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const unwrapAuditGroupSnapshot = (value = {}) => {
  if (!value || typeof value !== "object") return null;
  return normalizeAudienceGroup(value.group || value);
};

const unwrapAuditUserSnapshot = (value = {}) => {
  if (!value || typeof value !== "object") return null;
  return normalizeAccessUserRecord(value.user || value);
};

const auditTargetFromSnapshot = (value = {}) => {
  const user = unwrapAuditUserSnapshot(value);
  if (user?.email) return { targetType: "person", targetId: user.email, targetEmail: user.email, label: user.displayName || user.email };
  const group = unwrapAuditGroupSnapshot(value);
  if (group?.id) return { targetType: "group", targetId: group.id, targetEmail: "", label: group.label || group.id };
  return { targetType: "", targetId: "", targetEmail: "", label: "" };
};

const auditTargetFor = ({ eventType = "", targetEmail = "", before = null, after = null } = {}) => {
  const afterTarget = auditTargetFromSnapshot(after);
  const beforeTarget = auditTargetFromSnapshot(before);
  if (String(eventType).startsWith("group_")) {
    const targetId = afterTarget.targetId || beforeTarget.targetId || String(targetEmail || "").trim();
    return { targetType: "group", targetId, targetEmail: "", label: afterTarget.label || beforeTarget.label || targetId };
  }
  if (String(eventType).startsWith("user_")) {
    const email = afterTarget.targetEmail || beforeTarget.targetEmail || normalizeEmail(targetEmail);
    return { targetType: "person", targetId: email, targetEmail: email, label: afterTarget.label || beforeTarget.label || email };
  }
  if (String(eventType) === "access_undo") {
    const targetId = after?.targetId || before?.targetId || String(targetEmail || "").trim();
    const targetType = after?.targetType || before?.targetType || "";
    const email = targetType === "person" ? normalizeEmail(targetId || targetEmail) : "";
    return { targetType, targetId, targetEmail: email, label: after?.label || before?.label || targetId };
  }
  return { targetType: "", targetId: String(targetEmail || "").trim(), targetEmail: normalizeEmail(targetEmail), label: "" };
};

const auditActionFor = (eventType = "") => ({
  user_upserted: "person_saved",
  user_disabled: "person_disabled",
  group_upserted: "group_saved",
  group_archived: "group_archived",
  access_undo: "change_undone",
}[eventType] || "access_change");

const auditSummaryFor = ({ eventType = "", target = {}, before = null, after = null } = {}) => {
  const label = target.label || target.targetId || target.targetEmail || "access record";
  if (eventType === "user_upserted") return before ? `Updated ${label}` : `Created ${label}`;
  if (eventType === "user_disabled") return `Disabled ${label}`;
  if (eventType === "group_upserted") return before ? `Updated ${label}` : `Created ${label}`;
  if (eventType === "group_archived") return `Archived ${label}`;
  if (eventType === "access_undo") return `Undid ${after?.sourceEventType || before?.sourceEventType || "change"} for ${label}`;
  return `Changed ${label}`;
};

const auditHasUndoSnapshot = (event = {}) => {
  if (String(event.eventType || "").startsWith("user_")) return Boolean(unwrapAuditUserSnapshot(event.before)?.email);
  if (String(event.eventType || "").startsWith("group_")) return Boolean(unwrapAuditGroupSnapshot(event.before)?.id);
  return false;
};

const isAuditReversible = (event = {}) =>
  UNDOABLE_AUDIT_TYPES.has(event.eventType)
  && auditHasUndoSnapshot(event)
  && !event.revertedAt
  && !event.reverted_at;

const enrichAuditEvent = (event = {}) => {
  const eventType = event.eventType || event.event_type || "access_change";
  const before = event.before !== undefined ? event.before : parseAuditJsonValue(event.beforeJson || event.before_json);
  const after = event.after !== undefined ? event.after : parseAuditJsonValue(event.afterJson || event.after_json);
  const target = auditTargetFor({ eventType, targetEmail: event.targetEmail || event.target_email || event.targetId || event.target_id, before, after });
  const action = event.action || auditActionFor(eventType);
  const summary = event.summary || auditSummaryFor({ eventType, target, before, after });
  const enriched = {
    id: event.id || "",
    eventType,
    action,
    summary,
    actorEmail: normalizeEmail(event.actorEmail || event.actor_email || ""),
    targetType: event.targetType || event.target_type || target.targetType,
    targetId: event.targetId || event.target_id || target.targetId,
    targetEmail: event.targetEmail || event.target_email || target.targetEmail,
    before,
    after,
    reversible: event.reversible === true || event.reversible === 1 || event.reversible === "1",
    revertedAt: event.revertedAt || event.reverted_at || null,
    revertedBy: event.revertedBy || event.reverted_by || "",
    revertedEventId: event.revertedEventId || event.reverted_event_id || "",
    createdAt: event.createdAt || event.created_at || "",
  };
  enriched.reversible = enriched.reversible || isAuditReversible(enriched);
  if (enriched.revertedAt) enriched.reversible = false;
  return enriched;
};

const auditMetadataFor = ({ eventType, actorEmail, targetEmail, before, after }) => {
  const target = auditTargetFor({ eventType, targetEmail, before, after });
  const event = enrichAuditEvent({
    eventType,
    actorEmail,
    targetEmail: target.targetEmail,
    targetType: target.targetType,
    targetId: target.targetId,
    before,
    after,
    action: auditActionFor(eventType),
    summary: auditSummaryFor({ eventType, target, before, after }),
  });
  return {
    ...event,
    reversible: isAuditReversible(event),
  };
};

const fixtureEvents = () => FIXTURE_EVENTS.map((event) => ({ ...event, fixture: true }));

export const createMemoryAccessUserRegistry = (initialRecords = []) => {
  const users = new Map();
  const realEstateCredentials = new Map();
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
    const metadata = auditMetadataFor({ eventType, actorEmail, targetEmail, before, after });
    const event = {
      ...metadata,
      id: randomId("access-audit"),
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
    if (!options.skipAudit) audit("user_upserted", options.actorEmail || after.grantedBy || "", after.email, before, after);
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
    if (!options.skipAudit) audit("group_upserted", options.actorEmail || "", after.id, before, after);
    return clone(after);
  };

  const archiveAudienceGroup = async (groupId, options = {}) => {
    const beforeGroup = await getAudienceGroup(groupId);
    if (!beforeGroup) return null;
    const beforeMemberships = [...users.values()]
      .filter((record) => record.groupIds?.includes(beforeGroup.id))
      .map((record) => ({ email: record.email, groupId: beforeGroup.id }));
    const before = { group: beforeGroup, memberships: beforeMemberships };
    const timestamp = nowIso();
    const after = {
      ...beforeGroup,
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
    if (!options.skipAudit) audit("group_archived", options.actorEmail || "", after.id, before, { group: after, revokedMemberships: beforeMemberships });
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
    if (!options.skipAudit) audit("user_disabled", options.actorEmail || "", normalizedEmail, before, after);
    return clone(await decorate(after));
  };

  const realEstateCredentialKey = (email, galleryKey) => `${normalizeEmail(email)}::${String(galleryKey || "").trim()}`;

  const listRealEstateCredentials = async () => [...realEstateCredentials.values()]
    .map(publicRealEstateCredential)
    .sort((left, right) => `${left.email}:${left.galleryKey}`.localeCompare(`${right.email}:${right.galleryKey}`));

  const putRealEstateCredential = async (record, options = {}) => {
    const email = normalizeEmail(record.email);
    const galleryKey = canonicalRealEstateGalleryKey(record.galleryKey);
    const loginName = String(record.loginName || record.login || email).trim();
    if (!validEmail(email)) throw new Error("Real Estate password access requires a valid person email.");
    if (!galleryKey || !loginName) throw new Error("Real Estate password access requires a gallery and login name.");
    const key = realEstateCredentialKey(email, galleryKey);
    const before = realEstateCredentials.get(key) || null;
    const password = String(record.password || "");
    if (!before && !password) throw new Error("Set a password when creating Real Estate password access.");
    const salt = password ? randomSecret() : before.passwordSalt;
    const iterations = password ? REAL_ESTATE_PASSWORD_ITERATIONS : before.passwordIterations;
    const passwordHash = password ? await realEstatePasswordHash(password, salt, iterations) : before.passwordHash;
    const timestamp = nowIso();
    const after = {
      email,
      galleryKey,
      loginName,
      normalizedLogin: normalizeLogin(loginName),
      passwordSalt: salt,
      passwordHash,
      passwordIterations: iterations,
      state: "active",
      createdAt: before?.createdAt || timestamp,
      updatedAt: timestamp,
      updatedBy: normalizeEmail(options.actorEmail || ""),
    };
    realEstateCredentials.set(key, after);
    return publicRealEstateCredential(after);
  };

  const verifyRealEstateCredential = async ({ galleryKey, login, password } = {}) => {
    const normalizedGallery = String(galleryKey || "").trim();
    const normalizedLogin = normalizeLogin(login);
    const candidate = [...realEstateCredentials.values()].find((record) =>
      record.galleryKey === normalizedGallery
      && record.state === "active"
      && (record.normalizedLogin === normalizedLogin || normalizeEmail(record.email) === normalizedLogin)
    );
    if (!candidate) return null;
    const user = users.get(normalizeEmail(candidate.email));
    if (!user || user.disabledAt) return null;
    const enteredHash = await realEstatePasswordHash(password, candidate.passwordSalt, candidate.passwordIterations);
    if (!enteredHash || !timingSafeStringEqual(enteredHash, candidate.passwordHash)) return null;
    return publicRealEstateCredential(candidate);
  };

  const isRealEstateCredentialActive = async ({ galleryKey, email, loginName } = {}) => {
    const candidate = [...realEstateCredentials.values()].find((record) =>
      record.galleryKey === String(galleryKey || "").trim()
      && record.email === normalizeEmail(email)
      && record.state === "active"
      && (!loginName || record.normalizedLogin === normalizeLogin(loginName))
    );
    const user = candidate ? users.get(candidate.email) : null;
    return Boolean(candidate && user && !user.disabledAt);
  };

  const undoAuditEvent = async (auditId, options = {}) => {
    const event = auditEvents.find((item) => item.id === String(auditId || ""));
    if (!event) return null;
    const enriched = enrichAuditEvent(event);
    if (!isAuditReversible(enriched)) {
      throw Object.assign(new Error("This access change is not reversible."), {
        status: 409,
        code: "access_audit_not_reversible",
      });
    }
    const actorEmail = normalizeEmail(options.actorEmail || "");
    const timestamp = nowIso();
    let restored = null;
    if (String(enriched.eventType).startsWith("user_")) {
      const user = unwrapAuditUserSnapshot(enriched.before);
      restored = await putUser(user, { actorEmail, skipAudit: true });
    } else if (enriched.eventType === "group_upserted") {
      const group = unwrapAuditGroupSnapshot(enriched.before);
      restored = await putAudienceGroup(group, { actorEmail, skipAudit: true });
    } else if (enriched.eventType === "group_archived") {
      const group = unwrapAuditGroupSnapshot(enriched.before);
      restored = await putAudienceGroup(group, { actorEmail, skipAudit: true });
      const memberships = Array.isArray(enriched.before?.memberships) ? enriched.before.memberships : [];
      for (const membership of memberships) {
        const email = normalizeEmail(membership.email);
        const record = users.get(email);
        if (!record) continue;
        const groupIds = new Set(record.groupIds || []);
        groupIds.add(group.id);
        users.set(email, { ...record, groupIds: [...groupIds], updatedAt: timestamp });
      }
    }
    event.revertedAt = timestamp;
    event.revertedBy = actorEmail;
    event.reversible = false;
    const undoEvent = audit("access_undo", actorEmail, enriched.targetId || enriched.targetEmail, {
      sourceEventId: enriched.id,
      sourceEventType: enriched.eventType,
      targetType: enriched.targetType,
      targetId: enriched.targetId,
      label: enriched.summary,
    }, {
      sourceEventId: enriched.id,
      sourceEventType: enriched.eventType,
      targetType: enriched.targetType,
      targetId: enriched.targetId,
      label: enriched.summary,
      restored,
    });
    event.revertedEventId = undoEvent.id;
    return { event: clone(enrichAuditEvent(event)), undoEvent, restored };
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
    listAuditEvents: async (limit = 25) => auditEvents.slice(0, limit).map((event) => clone(enrichAuditEvent(event))),
    undoAuditEvent,
    listRealEstateCredentials,
    putRealEstateCredential,
    verifyRealEstateCredential,
    isRealEstateCredentialActive,
    _debug: { users, events, groups, auditEvents, realEstateCredentials },
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

const auditD1 = async (database, { eventType, actorEmail, targetEmail, before, after }) => {
  const metadata = auditMetadataFor({ eventType, actorEmail, targetEmail, before, after });
  const id = randomId("access-audit");
  await d1Run(database.prepare(`
    INSERT INTO pbe_access_audit_events (
      id, event_type, actor_email, target_email, target_type, target_id, action, summary,
      before_json, after_json, reversible, reverted_at, reverted_by, reverted_event_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, '', '', ?)
  `).bind(
    id,
    metadata.eventType,
    metadata.actorEmail,
    metadata.targetEmail,
    metadata.targetType,
    metadata.targetId,
    metadata.action,
    metadata.summary,
    JSON.stringify(before ?? null),
    JSON.stringify(after ?? null),
    metadata.reversible ? 1 : 0,
    nowIso()
  ));
  return { ...metadata, id };
};

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
    if (!options.skipAudit) await auditD1(database, { eventType: "user_upserted", actorEmail, targetEmail: normalized.email, before, after });
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
    if (!options.skipAudit) await auditD1(database, { eventType: "user_disabled", actorEmail, targetEmail: normalizedEmail, before, after });
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
    if (!options.skipAudit) await auditD1(database, { eventType: "group_upserted", actorEmail, targetEmail: normalized.id, before, after });
    return after;
  };

  const archiveAudienceGroup = async (groupId, options = {}) => {
    const normalizedGroupId = String(groupId || "").trim();
    const beforeGroup = await getAudienceGroup(normalizedGroupId);
    if (!beforeGroup) return null;
    const beforeMemberships = await d1All(database.prepare(`
      SELECT email, group_id AS groupId
      FROM pbe_access_group_memberships
      WHERE group_id = ? AND state = 'active'
      ORDER BY email
    `).bind(normalizedGroupId));
    const before = { group: beforeGroup, memberships: beforeMemberships };
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
    if (!options.skipAudit) {
      await auditD1(database, {
        eventType: "group_archived",
        actorEmail,
        targetEmail: normalizedGroupId,
        before,
        after: { group: after, revokedMemberships: beforeMemberships },
      });
    }
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

  const getAuditEvent = async (auditId) => d1First(database.prepare(`
    SELECT
      id,
      event_type AS eventType,
      actor_email AS actorEmail,
      target_email AS targetEmail,
      target_type AS targetType,
      target_id AS targetId,
      action,
      summary,
      before_json AS beforeJson,
      after_json AS afterJson,
      reversible,
      reverted_at AS revertedAt,
      reverted_by AS revertedBy,
      reverted_event_id AS revertedEventId,
      created_at AS createdAt
    FROM pbe_access_audit_events
    WHERE id = ?
  `).bind(String(auditId || "").trim())).then((row) => row ? enrichAuditEvent(row) : null);

  const markAuditEventReverted = async (auditId, { actorEmail, revertedEventId, timestamp }) => d1Run(database.prepare(`
    UPDATE pbe_access_audit_events
    SET reversible = 0,
        reverted_at = ?,
        reverted_by = ?,
        reverted_event_id = ?
    WHERE id = ?
  `).bind(timestamp, actorEmail, revertedEventId || "", auditId));

  const restoreMemberships = async (memberships = [], { actorEmail, timestamp }) => {
    for (const membership of memberships) {
      const email = normalizeEmail(membership.email);
      const groupId = String(membership.groupId || membership.group_id || "").trim();
      if (!validEmail(email) || !groupId) continue;
      await d1Run(database.prepare(`
        INSERT INTO pbe_access_group_memberships (
          id, email, group_id, state, granted_at, granted_by, revoked_at, revoked_by, updated_at, updated_by
        ) VALUES (?, ?, ?, 'active', ?, ?, NULL, '', ?, ?)
        ON CONFLICT(email, group_id) DO UPDATE SET
          state = 'active',
          revoked_at = NULL,
          revoked_by = '',
          updated_at = excluded.updated_at,
          updated_by = excluded.updated_by
      `).bind(randomId("group-member"), email, groupId, timestamp, actorEmail, timestamp, actorEmail));
    }
  };

  const undoAuditEvent = async (auditId, options = {}) => {
    const event = await getAuditEvent(auditId);
    if (!event) return null;
    if (!isAuditReversible(event)) {
      throw Object.assign(new Error("This access change is not reversible."), {
        status: 409,
        code: "access_audit_not_reversible",
      });
    }
    const actorEmail = normalizeEmail(options.actorEmail || "");
    const timestamp = nowIso();
    let restored = null;
    if (String(event.eventType).startsWith("user_")) {
      const user = unwrapAuditUserSnapshot(event.before);
      restored = await putUser(user, { actorEmail, skipAudit: true });
    } else if (event.eventType === "group_upserted") {
      const group = unwrapAuditGroupSnapshot(event.before);
      restored = await putAudienceGroup(group, { actorEmail, skipAudit: true });
    } else if (event.eventType === "group_archived") {
      const group = unwrapAuditGroupSnapshot(event.before);
      restored = await putAudienceGroup(group, { actorEmail, skipAudit: true });
      await restoreMemberships(Array.isArray(event.before?.memberships) ? event.before.memberships : [], { actorEmail, timestamp });
    }
    const undoEvent = await auditD1(database, {
      eventType: "access_undo",
      actorEmail,
      targetEmail: event.targetId || event.targetEmail,
      before: {
        sourceEventId: event.id,
        sourceEventType: event.eventType,
        targetType: event.targetType,
        targetId: event.targetId,
        label: event.summary,
      },
      after: {
        sourceEventId: event.id,
        sourceEventType: event.eventType,
        targetType: event.targetType,
        targetId: event.targetId,
        label: event.summary,
        restored,
      },
    });
    await markAuditEventReverted(event.id, { actorEmail, revertedEventId: undoEvent.id, timestamp });
    return {
      event: await getAuditEvent(event.id),
      undoEvent: await getAuditEvent(undoEvent.id),
      restored,
    };
  };

  const listAuditEvents = async (limit = 25) => d1All(database.prepare(`
    SELECT
      id,
      event_type AS eventType,
      actor_email AS actorEmail,
      target_email AS targetEmail,
      target_type AS targetType,
      target_id AS targetId,
      action,
      summary,
      before_json AS beforeJson,
      after_json AS afterJson,
      reversible,
      reverted_at AS revertedAt,
      reverted_by AS revertedBy,
      reverted_event_id AS revertedEventId,
      created_at AS createdAt
    FROM pbe_access_audit_events
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(Math.max(1, Math.min(100, Number(limit) || 25))))
    .then((rows) => rows.map(enrichAuditEvent));

  const listRealEstateCredentials = async () => d1All(database.prepare(`
    SELECT
      email,
      gallery_key AS galleryKey,
      login_name AS loginName,
      password_hash AS passwordHash,
      state,
      created_at AS createdAt,
      updated_at AS updatedAt,
      updated_by AS updatedBy
    FROM pbe_access_real_estate_credentials
    ORDER BY email, gallery_key
  `)).then((rows) => rows.map(publicRealEstateCredential));

  const putRealEstateCredential = async (record, options = {}) => {
    const email = normalizeEmail(record.email);
    const galleryKey = canonicalRealEstateGalleryKey(record.galleryKey);
    const loginName = String(record.loginName || record.login || email).trim();
    const normalizedLogin = normalizeLogin(loginName);
    if (!validEmail(email)) throw new Error("Real Estate password access requires a valid person email.");
    if (!galleryKey || !loginName) throw new Error("Real Estate password access requires a gallery and login name.");
    const person = await getUser(email);
    if (!person) throw new Error("Create the access person before setting a Real Estate password.");
    const before = await d1First(database.prepare(`
      SELECT * FROM pbe_access_real_estate_credentials WHERE email = ? AND gallery_key = ?
    `).bind(email, galleryKey));
    const password = String(record.password || "");
    if (!before && !password) throw new Error("Set a password when creating Real Estate password access.");
    const salt = password ? randomSecret() : before.password_salt;
    const iterations = password
      ? REAL_ESTATE_PASSWORD_ITERATIONS
      : Number(before.password_iterations || REAL_ESTATE_PASSWORD_ITERATIONS);
    const passwordHash = password
      ? await realEstatePasswordHash(password, salt, iterations)
      : before.password_hash;
    const timestamp = nowIso();
    const actorEmail = normalizeEmail(options.actorEmail || "");
    await d1Run(database.prepare(`
      INSERT INTO pbe_access_real_estate_credentials (
        id, email, gallery_key, login_name, normalized_login,
        password_hash, password_salt, password_iterations, state,
        created_at, created_by, updated_at, updated_by, revoked_at, revoked_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, NULL, '')
      ON CONFLICT(email, gallery_key) DO UPDATE SET
        login_name = excluded.login_name,
        normalized_login = excluded.normalized_login,
        password_hash = excluded.password_hash,
        password_salt = excluded.password_salt,
        password_iterations = excluded.password_iterations,
        state = 'active',
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by,
        revoked_at = NULL,
        revoked_by = ''
    `).bind(
      before?.id || randomId("re-credential"),
      email,
      galleryKey,
      loginName,
      normalizedLogin,
      passwordHash,
      salt,
      iterations,
      before?.created_at || timestamp,
      before?.created_by || actorEmail,
      timestamp,
      actorEmail
    ));
    const after = await d1First(database.prepare(`
      SELECT
        email,
        gallery_key AS galleryKey,
        login_name AS loginName,
        password_hash AS passwordHash,
        state,
        created_at AS createdAt,
        updated_at AS updatedAt,
        updated_by AS updatedBy
      FROM pbe_access_real_estate_credentials
      WHERE email = ? AND gallery_key = ?
    `).bind(email, galleryKey));
    return publicRealEstateCredential(after);
  };

  const verifyRealEstateCredential = async ({ galleryKey, login, password } = {}) => {
    const row = await d1First(database.prepare(`
      SELECT c.*, p.disabled_at AS person_disabled_at
      FROM pbe_access_real_estate_credentials c
      JOIN pbe_access_people p ON p.email = c.email
      WHERE c.gallery_key = ?
        AND (c.normalized_login = ? OR c.email = ?)
        AND c.state = 'active'
      LIMIT 1
    `).bind(canonicalRealEstateGalleryKey(galleryKey), normalizeLogin(login), normalizeEmail(login)));
    if (!row || row.person_disabled_at) return null;
    const enteredHash = await realEstatePasswordHash(password, row.password_salt, row.password_iterations);
    if (!enteredHash || !timingSafeStringEqual(enteredHash, row.password_hash)) return null;
    return publicRealEstateCredential(row);
  };

  const isRealEstateCredentialActive = async ({ galleryKey, email, loginName } = {}) => {
    const row = await d1First(database.prepare(`
      SELECT c.id
      FROM pbe_access_real_estate_credentials c
      JOIN pbe_access_people p ON p.email = c.email
      WHERE c.gallery_key = ?
        AND c.email = ?
        AND c.normalized_login = ?
        AND c.state = 'active'
        AND p.disabled_at IS NULL
      LIMIT 1
    `).bind(canonicalRealEstateGalleryKey(galleryKey), normalizeEmail(email), normalizeLogin(loginName || email)));
    return Boolean(row?.id);
  };

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
    undoAuditEvent,
    listRealEstateCredentials,
    putRealEstateCredential,
    verifyRealEstateCredential,
    isRealEstateCredentialActive,
  };
};
